"""Utility functions for time, paths, and file operations."""

import os
import time
import json
import hashlib
import uuid


def interval_to_sec(iv: str) -> int:
    """Convert interval string to seconds."""
    try:
        s = str(iv or 'minute1')
        if s.startswith('minute'):
            return int(s.replace('minute','')) * 60
        if s == 'day':
            return 86400
        if s == 'week':
            return 7*86400
        if s == 'month':
            return 30*86400
    except Exception:
        pass
    return 60


def bucket_ts_interval(ts_ms: int | None, iv: str) -> int:
    """Bucket timestamp by interval."""
    try:
        sec = interval_to_sec(iv)
        t = int((ts_ms or int(time.time()*1000)) / 1000)
        return (t // sec) * sec
    except Exception:
        return int(time.time())


def coin_key(interval: str, market: str, bucket_sec: int) -> str:
    """Generate key for NB coin storage."""
    return f"{market}|{interval}|{bucket_sec}"


def coin_store_path() -> str:
    """Get path to NB coins store file."""
    try:
        base_dir = os.path.dirname(os.path.dirname(__file__))
        data_dir = os.path.join(base_dir, 'data')
        os.makedirs(data_dir, exist_ok=True)
        return os.path.join(data_dir, 'nb_coins_store.json')
    except Exception:
        return 'nb_coins_store.json'


def save_nb_coins(coin_store: dict) -> bool:
    """Save NB coins to disk."""
    try:
        path = coin_store_path()
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(coin_store, f, ensure_ascii=False)
        return True
    except Exception:
        return False


def load_nb_coins(coin_store: dict) -> int:
    """Load NB coins from disk."""
    try:
        path = coin_store_path()
        if not os.path.exists(path):
            return 0
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, dict):
            coin_store.clear()
            coin_store.update(data)
            return len(coin_store)
        return 0
    except Exception:
        return 0


def hash_text(s: str) -> str:
    """Generate hash for text."""
    try:
        return hashlib.sha1(s.encode('utf-8')).hexdigest()
    except Exception:
        return str(uuid.uuid4())


def bucket_ts(ts_ms: int | None = None, bucket_sec: int | None = None) -> int:
    """Bucket timestamp by seconds."""
    try:
        bs = int(bucket_sec or 60)
        t = int((ts_ms or int(time.time()*1000)) / 1000)
        return (t // bs) * bs
    except Exception:
        return int(time.time())


def trainer_storage_path() -> str:
    """Get path to trainer storage file."""
    try:
        base_dir = os.path.dirname(os.path.dirname(__file__))
        data_dir = os.path.join(base_dir, 'data')
        os.makedirs(data_dir, exist_ok=True)
        return os.path.join(data_dir, 'trainer_storage.json')
    except Exception:
        return 'trainer_storage.json'


def trust_config_path() -> str:
    """Get path to trust config file."""
    try:
        base_dir = os.path.dirname(os.path.dirname(__file__))
        data_dir = os.path.join(base_dir, 'data')
        os.makedirs(data_dir, exist_ok=True)
        return os.path.join(data_dir, 'trust_config.json')
    except Exception:
        return 'trust_config.json'


def model_path_for(interval: str) -> str:
    """Get model path for specific interval."""
    try:
        base_dir = os.path.dirname(os.path.dirname(__file__))
        models_dir = os.path.join(base_dir, 'models')
        os.makedirs(models_dir, exist_ok=True)
        return os.path.join(models_dir, f'nb_ml_{interval}.pkl')
    except Exception:
        return f'nb_ml_{interval}.pkl'


def ensure_models_dir():
    """Ensure models directory exists."""
    try:
        base_dir = os.path.dirname(os.path.dirname(__file__))
        models_dir = os.path.join(base_dir, 'models')
        os.makedirs(models_dir, exist_ok=True)
    except Exception:
        pass


def ensure_data_dir():
    """Ensure data directory exists."""
    try:
        base_dir = os.path.dirname(os.path.dirname(__file__))
        data_dir = os.path.join(base_dir, 'data')
        os.makedirs(data_dir, exist_ok=True)
    except Exception:
        pass
