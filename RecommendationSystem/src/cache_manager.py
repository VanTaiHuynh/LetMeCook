import threading
import json
import tempfile
import time
import torch
import pandas as pd
from datetime import datetime, timedelta
from typing import Tuple, List,Optional
import logging
from pathlib import Path
import os
import fcntl

from src.clean_data import combine_fields
from src.embed_with_sbert import append_embedding, remove_embeddings, load_embeddings, model_dir, public_ids
from src import legacy_cache_store as store
from dotenv import load_dotenv
from sqlalchemy import text
from src.database import get_engine

load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class RecipeCache:
    def __init__(self, cache_duration_minutes: Optional[int] = None):
        # Mặc định 1 ngày; cho phép override qua  ENV
        minutes = cache_duration_minutes if cache_duration_minutes is not None \
            else int(os.getenv("CACHE_DURATION_MINUTES", "1440"))
        self._cache_duration = timedelta(minutes=minutes)
        self._last_reload = None
        self._recipe_ids = None
        self._embeddings = None
        self._lock = threading.RLock()
        self._reload_timer = None
        self._is_loading = False
        self._last_error = None
        self._cache_error = None
        self._generation = None
        self._job_fd = None
        self._rebuild_lock = threading.Lock()

        # Leader election state
        self._is_leader = False
        self._lockfile_fd = None
        self._lockfile_path = "/tmp/letmecook_scheduler.lock"

        # Ensure model directory exists
        model_dir()

        # Initial load
        self._load_cache()
        previous = self.get_rebuild_status()
        if previous.get("status") == "failed":
            self._last_error = previous.get("error") or "Previous rebuild failed"
        interrupted = previous.get("status") in {"queued", "running"}
        if (not self._recipe_ids or interrupted) and self._is_leader and os.getenv("REBUILD_CACHE_ON_START", "false").lower() == "true":
            # Resume an interrupted rebuild even when an older cache still exists.
            self.force_reload()

    def _load_from_disk(self) -> Tuple[List[str], torch.Tensor]:
        """Missing/incomplete upstream cache files are a valid empty cache."""
        try:
            return load_embeddings()
        except Exception as error:
            self._last_error = type(error).__name__
            self._cache_error = type(error).__name__
            logger.warning("Legacy cache rejected: %s", type(error).__name__)
            return [], torch.empty((0, 384))

    def _rebuild_embeddings(self):
        """Rebuild embeddings from database"""
        try:
            logger.info("🔄 Starting embedding rebuild...")

            # Import here to avoid circular imports
            from src.pipeline import run_pipeline

            # Run the full pipeline
            run_pipeline()

            logger.info("✅ Embedding rebuild completed")

        except Exception as e:
            logger.error('Legacy rebuild failed: %s',type(e).__name__)
            raise

    def _load_cache(self):
        """Load cache with thread safety"""
        with self._lock:
            if self._is_loading:
                return

            self._is_loading = True
            self._last_error = None
            self._cache_error = None
            try:
                # Try to load from disk first
                recipe_ids, embeddings = self._load_from_disk()

                self._recipe_ids = recipe_ids
                self._embeddings = embeddings
                self._last_reload = datetime.now()
                try:self._generation = store.generation_name()
                except store.CacheInvalid:
                    self._generation=None;self._cache_error='CacheInvalid';self._last_error='CacheInvalid'

                logger.info(f"✅ Cache loaded: {len(recipe_ids)} recipes")

                if self._become_leader():
                    logger.info('Scheduler leader; automatic rebuild enabled=%s',os.getenv('CACHE_AUTO_REBUILD','false').lower()=='true')
                    if os.getenv("CACHE_AUTO_REBUILD", "false").lower() == "true":
                        self._schedule_reload()
                else:
                    logger.info("🧭 Not leader; skip auto-reload scheduling in this worker.")

            finally:
                self._is_loading = False

    def _schedule_reload(self):
        """Schedule automatic cache reload"""
        if self._reload_timer:
            self._reload_timer.cancel()
        if os.getenv("CACHE_AUTO_REBUILD", "false").lower() != "true":
            return

        def reload_task():
            logger.info("Auto-reloading cache...")
            self.force_reload()

        self._reload_timer = threading.Timer(
            self._cache_duration.total_seconds(),
            reload_task
        )
        self._reload_timer.daemon = True
        self._reload_timer.start()

        next_reload = datetime.now() + self._cache_duration
        logger.info(f"⏰ Next auto-reload scheduled at: {next_reload.strftime('%Y-%m-%d %H:%M:%S')}")

    def _become_leader(self) -> bool:
        """Elect a single scheduler leader across Gunicorn workers via file lock."""
        if self._is_leader:
            return True
        fd = None
        try:
            fd = os.open(self._lockfile_path, os.O_CREAT | os.O_RDWR, 0o644)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            os.ftruncate(fd, 0)
            os.write(fd, str(os.getpid()).encode())
            os.fsync(fd)
            self._lockfile_fd = fd
            self._is_leader = True
            return True
        except OSError:
            # another worker already holds the lock
            if fd is not None:
                os.close(fd)
            if self._lockfile_fd is not None:
                try:
                    os.close(self._lockfile_fd)
                except Exception:
                    pass
                self._lockfile_fd = None
            return False

    def get_data(self) -> Tuple[List[str], torch.Tensor]:
        """Compatibility copy. Internal readers use get_snapshot without cloning."""
        ids,vectors=self.get_snapshot()
        return list(ids),vectors.clone()

    def get_snapshot(self):
        """Reload a changed pointer; current catalog visibility is never cached."""
        current=store.generation_name()
        if current != self._generation:
            self._load_cache()
        with self._lock:
            ids=tuple(self._recipe_ids)
            vectors=self._embeddings
            error=self._cache_error
        if error:
            raise store.CacheInvalid('The legacy generation is unavailable; an explicit rebuild or migration is required.')
        if not ids:
            return ids,vectors
        allowed=public_ids()
        revoked=set(ids)-allowed
        if revoked:
            # This is permission invalidation, never a model rebuild. Remove from
            # the current generation before returning an eligible reader snapshot.
            remove_embeddings(revoked)
            self._load_cache()
            keep=[i for i,key in enumerate(ids) if key in allowed]
            return tuple(ids[i] for i in keep),vectors[keep]
        return ids,vectors

    def is_cache_valid(self) -> bool:
        """Check if cache is still valid"""
        if self._last_reload is None:
            return False
        return datetime.now() - self._last_reload < self._cache_duration

    def get_rebuild_status(self):
        """Rebuild state lives on the model volume and survives a worker restart."""
        path = model_dir() / "rebuild_status.json"
        try:
            state=json.loads(path.read_text())
            if not isinstance(state,dict) or state.get('status') not in {'idle','queued','running','complete','failed'}:
                return {'status':'idle'}
            if 'error' in state:
                error=state['error']
                state['error']=error if isinstance(error,str) and error.isidentifier() and len(error)<=80 else 'Previous publisher failed'
            return state
        except (FileNotFoundError, json.JSONDecodeError):
            return {"status": "idle"}

    def _write_rebuild_status(self, status):
        directory = model_dir()
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", prefix="rebuild-status-",
                                         suffix=".tmp", dir=directory, delete=False) as handle:
            json.dump(status, handle, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
            temporary = Path(handle.name)
        try:
            temporary.replace(directory / "rebuild_status.json")
        finally:
            temporary.unlink(missing_ok=True)

    def force_reload(self):
        """Start one background rebuild; duplicate requests share the current job."""
        if not self._rebuild_lock.acquire(blocking=False):
            return False
        try:
            job=model_dir()/'legacy-sbert'/'rebuild.lock'
            job.parent.mkdir(parents=True,exist_ok=True)
            fd=os.open(job,os.O_CREAT|os.O_RDWR,0o600)
        except Exception:
            self._rebuild_lock.release();raise
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd);self._rebuild_lock.release();return False
        except Exception:
            os.close(fd);self._rebuild_lock.release();raise
        requested_at = datetime.now().isoformat()
        try:
            self._write_rebuild_status({"status": "queued", "requested_at": requested_at})
        except Exception:
            fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)
            self._rebuild_lock.release()
            raise
        if self._reload_timer:
            self._reload_timer.cancel()

        def reload_task():
            try:
                self._write_rebuild_status({"status": "running", "requested_at": requested_at,
                                            "started_at": datetime.now().isoformat()})
                self._rebuild_embeddings()
                # Install the completed cache in this worker, without rebuilding again.
                self._load_cache()
                self._write_rebuild_status({"status": "complete", "requested_at": requested_at,
                                            "finished_at": datetime.now().isoformat(), "recipe_count": len(self._recipe_ids)})
            except Exception as error:
                self._last_error = type(error).__name__
                logger.error("Cache rebuild failed: %s", type(error).__name__)
                try:
                    self._write_rebuild_status({"status": "failed", "requested_at": requested_at,
                                                "finished_at": datetime.now().isoformat(), "error": type(error).__name__})
                finally:
                    self._schedule_reload()
            finally:
                fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)
                self._rebuild_lock.release()

        try:
            threading.Thread(target=reload_task, daemon=True).start()
        except Exception:
            fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)
            self._rebuild_lock.release()
            raise
        return True

    def add_recipe_to_cache(self, recipe_id: str):
        """Source fetch and publication share the same filesystem writer lock."""
        from src.download_from_supabase import QUERY
        from src.local_ai import public_catalog_clause
        with store.writer_lock():
            # Reuse exactly the export query, including current public/demo gate.
            query=QUERY.replace('WHERE '+public_catalog_clause('r'),
                                'WHERE r.id = :recipe_id AND '+public_catalog_clause('r'))
            engine=get_engine()
            try:
                with engine.connect() as connection:
                    df=pd.read_sql(text(query),connection,params={'recipe_id':recipe_id})
            finally:engine.dispose()
            if df.empty:
                remove_embeddings([recipe_id])
                self._load_cache()
                raise ValueError('Recipe is not available in the public catalog')
            append_embedding(recipe_id,combine_fields(df.iloc[0]))
        self._load_cache()

    def remove_recipes_from_cache(self, recipe_ids: List[str]):
        remove_embeddings(recipe_ids)
        self._load_cache()

    def get_cache_info(self) -> dict:
        """Get cache information"""
        try:changed=store.generation_name()!=self._generation
        except store.CacheInvalid:changed=True
        if changed:self._load_cache()
        with self._lock:
            return {
                "recipe_count": len(self._recipe_ids) if self._recipe_ids else 0,
                "generation": self._generation,
                "format": "immutable-sbert-v1",
                "automatic_rebuild_enabled": os.getenv("CACHE_AUTO_REBUILD", "false").lower() == "true",
                "last_error": self._last_error,
                "generation_error": self._cache_error,
                "rebuild_status": self.get_rebuild_status(),
                "last_reload": self._last_reload.isoformat() if self._last_reload else None,
                "is_valid": self.is_cache_valid(),
                "next_reload": (self._last_reload + self._cache_duration).isoformat() if self._last_reload else None,
                "cache_duration_minutes": self._cache_duration.total_seconds() / 60
            }

    def shutdown(self):
        """Clean shutdown of cache manager"""
        if self._reload_timer:
            self._reload_timer.cancel()
        # Release leader lock if held
        if self._is_leader and self._lockfile_fd is not None:
            try:
                fcntl.flock(self._lockfile_fd, fcntl.LOCK_UN)
            except Exception:
                pass
            try:
                os.close(self._lockfile_fd)
            except Exception:
                pass
            self._lockfile_fd = None
            self._is_leader = False
        logger.info("🛑 Cache manager shutdown")


# Global cache instance
_cache_instance = None
_cache_lock = threading.Lock()


def get_cache() -> RecipeCache:
    """Get global cache instance (singleton pattern)"""
    global _cache_instance

    if _cache_instance is None:
        with _cache_lock:
            if _cache_instance is None:
                _cache_instance = RecipeCache()

    return _cache_instance


def shutdown_cache():
    """Shutdown global cache instance"""
    global _cache_instance

    if _cache_instance:
        _cache_instance.shutdown()
        _cache_instance = None
