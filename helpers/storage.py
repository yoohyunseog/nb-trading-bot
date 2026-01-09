"""Storage functions for trainer and trust data."""

import os
import json
import time


def load_trainer_storage(trainer_storage_path_func, default_storage):
    """Load trainer storage from disk."""
    try:
        path = trainer_storage_path_func()
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # Merge with default structure
                for trainer in ['Scout', 'Guardian', 'Analyst', 'Elder']:
                    if trainer not in data:
                        data[trainer] = {
                            'coins': 0.0,
                            'entry_price': 0.0,
                            'last_update': None,
                            'total_profit': 0.0,
                            'ticks': 0,
                            'trades': []
                        }
                    # Add ticks counter if missing
                    if 'ticks' not in data[trainer]:
                        data[trainer]['ticks'] = 0
                return data
    except Exception:
        pass
    return default_storage.copy()


def save_trainer_storage(trainer_storage_path_func, trainer_storage):
    """Save trainer storage to disk."""
    try:
        path = trainer_storage_path_func()
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(trainer_storage, f, indent=2, ensure_ascii=False)
    except Exception:
        pass


def load_trust_config(trust_config_path_func) -> dict:
    """Load trust config from disk."""
    try:
        with open(trust_config_path_func(), 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'ml_trust': 50.0, 'nb_trust': 50.0, 'last_updated': None}


def save_trust_config(trust_config_path_func, trust_config):
    """Save trust config to disk."""
    try:
        trust_config['last_updated'] = int(time.time() * 1000)
        with open(trust_config_path_func(), 'w', encoding='utf-8') as f:
            json.dump(trust_config, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving trust config: {e}")


def update_trainer_storage(trainer_storage, trainer: str, action: str, price: float, size: float, profit: float = 0.0):
    """Update trainer storage with trade."""
    try:
        if trainer not in trainer_storage:
            return
        
        storage = trainer_storage[trainer]
        now = int(time.time() * 1000)
        
        # Initialize ticks counter if missing
        if 'ticks' not in storage:
            storage['ticks'] = 0
        
        if action.upper() == 'BUY':
            # Buy: add coins
            storage['coins'] += size
            storage['entry_price'] = price
            storage['last_update'] = now
            storage['ticks'] += 1
            storage['trades'].append({
                'ts': now,
                'action': 'BUY',
                'price': price,
                'size': size,
                'profit': 0.0
            })
            
        elif action.upper() == 'SELL':
            # Sell: subtract coins and calculate profit
            if storage['coins'] >= size:
                storage['coins'] -= size
                storage['last_update'] = now
                storage['total_profit'] += profit
                storage['ticks'] += 1
                storage['trades'].append({
                    'ts': now,
                    'action': 'SELL',
                    'price': price,
                    'size': size,
                    'profit': profit
                })
                # Reset entry price if all sold
                if storage['coins'] <= 0:
                    storage['coins'] = 0.0
                    storage['entry_price'] = 0.0
    except Exception as e:
        print(f"Error updating trainer storage for {trainer}: {e}")
