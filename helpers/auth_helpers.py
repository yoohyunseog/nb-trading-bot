"""Helper functions for authentication and key management."""

import os


def _mask_key(v: str | None) -> str:
    """Mask a key for safe display."""
    if not v:
        return ''
    try:
        s = str(v)
        if len(s) <= 8:
            return s[:2] + ('*' * max(0, len(s) - 4)) + s[-2:]
        return s[:4] + ('*' * (len(s) - 8)) + s[-4:]
    except Exception:
        return '<?>'


def _get_runtime_keys(bot_ctrl):
    """Return a tuple of (std_ak, std_sk, open_ak, open_sk) from overrides/env."""
    ov = bot_ctrl['cfg_override']
    std_ak = (ov.get('access_key') if isinstance(ov, dict) else None) or os.getenv('UPBIT_ACCESS_KEY')
    std_sk = (ov.get('secret_key') if isinstance(ov, dict) else None) or os.getenv('UPBIT_SECRET_KEY')
    open_ak = (ov.get('open_api_access_key') if isinstance(ov, dict) else None) or os.getenv('UPBIT_OPEN_API_ACCESS_KEY')
    open_sk = (ov.get('open_api_secret_key') if isinstance(ov, dict) else None) or os.getenv('UPBIT_OPEN_API_SECRET_KEY')
    return std_ak, std_sk, open_ak, open_sk


def log_env_keys(bot_ctrl):
    """Log masked API keys for debugging."""
    std_ak, std_sk, open_ak, open_sk = _get_runtime_keys(bot_ctrl)
    print(f"[ENV] UPBIT_ACCESS_KEY={_mask_key(std_ak)} UPBIT_SECRET_KEY={_mask_key(std_sk)}")
    print(f"[ENV] UPBIT_OPEN_API_ACCESS_KEY={_mask_key(open_ak)} UPBIT_OPEN_API_SECRET_KEY={_mask_key(open_sk)}")


def _reload_env_vars() -> bool:
    """Reload environment variables from .env files."""
    from dotenv import load_dotenv
    try:
        # project root
        load_dotenv()
        load_dotenv("env.local", override=False)
        # bot dir (this file)
        base_dir = os.path.dirname(__file__)
        base_dir = os.path.dirname(base_dir)  # go up one level from helpers/
        load_dotenv(os.path.join(base_dir, ".env"), override=True)
        load_dotenv(os.path.join(base_dir, "env.local"), override=True)
        return True
    except Exception:
        return False
