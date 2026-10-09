#!/usr/bin/env python3
"""Run independent local verification lanes in parallel with separate logs.

The AI tests use current source in a disposable offline container without live
credentials, database access, models, or data volumes. --build additionally
validates Docker images; unchanged Docker layers can reuse earlier test results.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jobs", type=int, choices=range(1, 5), default=3)
    parser.add_argument("--build", action="store_true", help="Also build all three application images with Compose")
    parser.add_argument("--output", type=Path, help="Log directory; default is a new temporary directory")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    output = (args.output or Path(tempfile.mkdtemp(prefix="letmecook-verification-"))).resolve()
    output.mkdir(parents=True, exist_ok=True)
    node, docker, npm = shutil.which("node"), shutil.which("docker"), shutil.which("npm")
    if not node or not docker or not npm:
        parser.error("Node.js and Docker are required for local verification.")
    utility_tests = sorted([*repo.glob("client/src/utils/*.test.js"), *repo.glob("client/src/utils/*.test.mjs")])
    if not utility_tests:
        parser.error("No client utility test files found.")
    worker_command = (
        "from src.runtime_threads import configure_cpu_threads; configure_cpu_threads(); "
        "import sys,unittest; "
        "result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.discover('tests')); "
        "sys.exit(not result.wasSuccessful())"
    )
    test_container = "letmecook-verify-" + uuid.uuid4().hex[:12]
    lanes = {
        "client-tests": ([node, "--test", *map(str, utility_tests)], 180),
        "client-components": ([npm, "--prefix", "client", "run", "test:components"], 180),
        "deploy-tests": (["python3", "-m", "unittest", "discover", "-s", "deploy/tests", "-p", "test_*.py"], 180),
        "seo-tests": ([node, "--test", str(repo / "deploy/seo/gateway.test.mjs")], 180),
        "ai-tests": ([docker, "run", "--rm", "--name", test_container, "--network", "none", "--cpus", "16", "--memory", "8g",
                      "--read-only", "--tmpfs", "/tmp:rw,size=2g,mode=1777",
                      "-e", "OMP_NUM_THREADS=16",
                      "-v", f"{repo / 'RecommendationSystem/src'}:/app/src:ro",
                      "-v", f"{repo / 'RecommendationSystem/tests'}:/app/tests:ro",
                      "-v", f"{repo / 'RecommendationSystem/evaluation'}:/app/evaluation:ro",
                      "-v", f"{repo / 'RecommendationSystem/app.py'}:/app/app.py:ro",
                      "--entrypoint", "python", "letmecook-recommendation", "-c", worker_command], 180),
    }
    if args.build:
        if not (repo / "deploy/.env.local").is_file():
            parser.error("--build requires the existing deploy/.env.local configuration.")
        lanes["docker-build"] = ([docker, "compose", "--env-file", "deploy/.env.local", "-f",
                                  "deploy/compose.yaml", "build", "web", "backend", "recommendation"], 900)

    def run_lane(name, command, timeout):
        start = time.monotonic()
        log = output / (name + ".log")
        with log.open("w") as handle:
            try:
                child = subprocess.run(command, cwd=repo, stdout=handle, stderr=subprocess.STDOUT, timeout=timeout)
                code, state = child.returncode, "passed" if child.returncode == 0 else "failed"
            except subprocess.TimeoutExpired:
                code, state = 124, "timeout"
            except OSError:
                code, state = 127, "could-not-start"
            finally:
                if name == "ai-tests":
                    # Kill only this run's uniquely named container if a timeout
                    # terminated its Docker client before --rm could finish.
                    subprocess.run([docker, "rm", "-f", test_container], stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=15)
        return {"lane": name, "status": state, "exitCode": code,
                "wallSeconds": round(time.monotonic() - start, 3), "log": str(log)}

    start = time.monotonic()
    rows = []
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        pending = [pool.submit(run_lane, name, *arguments) for name, arguments in lanes.items()]
        for future in as_completed(pending):
            row = future.result()
            rows.append(row)
            print(json.dumps(row), flush=True)
    summary = {"generatedAt": datetime.now(timezone.utc).isoformat(), "jobs": args.jobs,
               "wallSeconds": round(time.monotonic() - start, 3), "lanes": sorted(rows, key=lambda row: row["lane"]),
               "allPassed": all(row["exitCode"] == 0 for row in rows),
               "limits": ["Rendered React tests are local; no live browser/UI checks or production load test",
                          "The optional Docker build may reuse cached Java test layers; review its log",
                          "AI tests use current mounted source, mocked external dependencies, and an offline disposable container"]}
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({"allPassed": summary["allPassed"], "wallSeconds": summary["wallSeconds"], "summary": str(output / "summary.json")}), flush=True)
    return 0 if summary["allPassed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
