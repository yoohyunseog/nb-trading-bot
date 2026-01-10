import os
from pathlib import Path

model_dir = Path('models')
files_to_delete = [
    'card_rating_model.pkl',
    'card_rating_scaler.pkl',
    'card_rating_meta.json'
]

for fname in files_to_delete:
    fpath = model_dir / fname
    if fpath.exists():
        fpath.unlink()
        print(f'✓ 삭제됨: {fname}')
    else:
        print(f'- 없음: {fname}')

print('\n✓ 모델 파일 초기화 완료')
