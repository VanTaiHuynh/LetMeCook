"""The process-local inference queue requires exactly one worker process."""
workers = 1
threads = 8
bind = '127.0.0.1:9501'
timeout = 180


def on_starting(server):
    if server.cfg.workers != 1:
        raise RuntimeError('LetMeCook local inference requires exactly one Gunicorn worker process')
