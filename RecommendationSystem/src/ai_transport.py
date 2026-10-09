"""Loopback-only bounded streaming transport with exact provisioned model pins."""
import json
import os
import re
import socket
import urllib.error
import urllib.request

from src.ai_config import OLLAMA_URL, TEXT_MODEL, VISION_MODEL
from src.ai_errors import AIError
from src.inference_queue import queue, QueueBusy
from src import request_context as context


def digest(value):
    if not isinstance(value, str) or not re.fullmatch(r'(?:sha256:)?[0-9a-f]{64}', value):
        raise AIError('The configured local model digest is missing or invalid. Provision the pinned model explicitly.', 503)
    return value.removeprefix('sha256:')


def model_pin(model, metadata=None):
    from src import local_ai as facade
    key = 'LOCAL_AI_VISION_DIGEST' if model == VISION_MODEL else 'LOCAL_AI_TEXT_DIGEST'
    expected = digest(os.getenv(key, ''))
    if model not in (TEXT_MODEL, VISION_MODEL):
        raise AIError('That model is outside the provisioned local contract.', 503)
    tags = metadata if metadata is not None else facade._ollama('/api/tags', timeout=2)
    entries = [item for item in tags.get('models', []) if item.get('name') == model]
    if len(entries) != 1 or digest(entries[0].get('digest', '')) != expected:
        raise AIError('The installed local model does not match its configured digest. Re-provision it explicitly.', 503)
    return {'model': model, 'digest': expected}


def _close_response(response):
    # Closing the streaming connection asks Ollama to abandon this generation.
    # Socket shutdown also wakes a blocked reader during explicit cancellation.
    try: response.fp.raw._sock.shutdown(socket.SHUT_RDWR)
    except (AttributeError, OSError): pass
    response.close()


def ollama(path, body=None, timeout=120):
    context.checkpoint()
    data = None if body is None else json.dumps(body, allow_nan=False).encode('utf-8')
    request = urllib.request.Request(OLLAMA_URL + path, data=data,
                                    headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=context.remaining(timeout)) as response:
            with context.interruptible(lambda: _close_response(response)):
                if body and body.get('stream') is True:
                    content, size, done = [], 0, False
                    for line in response:
                        context.checkpoint()
                        if len(line) > 262144:
                            raise AIError('Local model response exceeded its bounded contract.', 502)
                        chunk = json.loads(line)
                        if chunk.get('error'):
                            raise AIError('The local model could not complete this request.', 503)
                        part = chunk.get('message', {}).get('content', '')
                        if not isinstance(part, str): raise ValueError('Invalid streamed content')
                        size += len(part)
                        if size > 2000000:
                            raise AIError('Local model response exceeded its bounded contract.', 502)
                        content.append(part)
                        if chunk.get('done') is True:
                            done = True
                            break
                    if not done: raise AIError('Local model response ended before completion.', 502)
                    return {'message': {'content': ''.join(content)}}
                raw = response.read(2000001)
                context.checkpoint()
                if len(raw) > 2000000: raise AIError('Local service response is too large.', 502)
                return json.loads(raw)
    except AIError:
        raise
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
        context.checkpoint()
        raise AIError('Local model unavailable or timed out. Check Ollama and installed models, then retry.', 503) from error


def chat(model, system, content, schema, images=None, priority=None):
    from src import local_ai as facade
    try:
        with queue.slot(priority or ('vision' if images else None)):
            return facade._chat_unqueued(model, system, content, schema, images, priority)
    except QueueBusy as error:
        raise AIError(str(error), 429) from error


def chat_unqueued(model, system, content, schema, images=None, priority=None):
    from src import local_ai as facade
    context.checkpoint()
    if not facade._gate.acquire(blocking=False):
        raise AIError('Local AI is processing another request. Please retry shortly.', 429)
    try:
        model_pin(model)
        user = {'role': 'user', 'content': content}
        if images: user['images'] = images
        response = facade._ollama('/api/chat', {'model': model, 'stream': True,
            'think': False, 'keep_alive': '5m', 'format': schema,
            'messages': [{'role': 'system', 'content': system}, user],
            'options': {'temperature': 0, 'num_ctx': 8192 if priority == 'cook' else 4096,
                        'num_predict': 1024 if images else 2000 if priority == 'cook' else 450}})
        context.checkpoint()
        try:
            parsed = json.loads(response['message']['content'])
            if not isinstance(parsed, dict): raise ValueError('Object expected')
            return parsed
        except (KeyError, TypeError, ValueError) as error:
            raise AIError('Local model returned an invalid result. Please retry or use manual filters.', 502) from error
    finally:
        facade._gate.release()
