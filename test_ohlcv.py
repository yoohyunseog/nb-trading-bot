"""
Test OHLCV endpoint to verify no null values
"""
import requests
import json

def test_ohlcv():
    """Test OHLCV endpoint for null values"""
    url = "http://localhost:5100/api/ohlcv?interval=minute10&count=100"
    
    try:
        response = requests.get(url, timeout=10)
        data = response.json()
        
        if 'data' not in data:
            print("❌ No 'data' field in response")
            return False
        
        candles = data['data']
        print(f"✅ Received {len(candles)} candles")
        
        # Check for null values
        errors = []
        for i, candle in enumerate(candles):
            for key in ['time', 'open', 'high', 'low', 'close']:
                value = candle.get(key)
                if value is None:
                    errors.append(f"Candle {i}: {key} is None")
                elif not isinstance(value, (int, float)):
                    errors.append(f"Candle {i}: {key} is not a number ({type(value)})")
                elif key != 'time' and value <= 0:
                    errors.append(f"Candle {i}: {key} is <= 0 ({value})")
        
        if errors:
            print(f"❌ Found {len(errors)} errors:")
            for error in errors[:10]:  # Show first 10 errors
                print(f"  - {error}")
            return False
        
        print("✅ All candles are valid!")
        print(f"Sample candle: {json.dumps(candles[0], indent=2)}")
        return True
        
    except requests.exceptions.ConnectionError:
        print("❌ Server not running on localhost:5100")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == '__main__':
    print("Testing OHLCV endpoint...")
    print("=" * 50)
    success = test_ohlcv()
    print("=" * 50)
    if success:
        print("✅ TEST PASSED")
    else:
        print("❌ TEST FAILED")
