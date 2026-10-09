"""Configure measured CPU parallelism once, before model/cache work starts.

Torch inter-op thread count can only be set before parallel work begins. The web
entrypoint and offline embedding entrypoint call this helper before their Torch
imports; request handlers never change process-wide thread settings.
"""
import os
import threading

DEFAULT_CPU_THREADS = 16
MAX_CPU_THREADS = 24
_lock = threading.Lock()
_configured_pid = None
_configuration = None


def configured_cpu_threads():
    value = os.environ.get("OMP_NUM_THREADS", str(DEFAULT_CPU_THREADS))
    try:
        threads = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError("OMP_NUM_THREADS must be an integer between 1 and 24") from error
    if not 1 <= threads <= MAX_CPU_THREADS:
        raise ValueError("OMP_NUM_THREADS must be an integer between 1 and 24")
    return threads


def configure_cpu_threads():
    global _configured_pid, _configuration
    threads = configured_cpu_threads()
    with _lock:
        pid = os.getpid()
        if _configured_pid == pid:
            if _configuration["intraop_threads"] != threads:
                raise RuntimeError("CPU thread settings changed after initialization; restart the worker")
            return dict(_configuration)
        # Environment settings must exist before Torch/tokenizer imports. Explicit
        # operator overrides are preserved; Torch intra-op uses the validated OMP
        # value, matching the benchmark rather than a library's CPU-count default.
        defaults = {"OMP_NUM_THREADS": str(threads), "MKL_NUM_THREADS": str(threads),
                    "OPENBLAS_NUM_THREADS": "1", "NUMEXPR_NUM_THREADS": "1",
                    "TOKENIZERS_PARALLELISM": "false"}
        for name, value in defaults.items():
            os.environ.setdefault(name, value)
        import torch
        torch.set_num_threads(threads)
        torch.set_num_interop_threads(1)
        _configuration = {"intraop_threads": torch.get_num_threads(),
                          "interop_threads": torch.get_num_interop_threads()}
        _configured_pid = pid
        return dict(_configuration)
