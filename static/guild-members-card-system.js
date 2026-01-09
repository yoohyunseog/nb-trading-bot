// ===== N/B 길드 엔진 시스템 =====

// 게임 상태
let gameRunning = true;
let gameObjects = [];
let bitcoinSquare = null;
let nbGuildPolygon = null;
let animationId;

// 캔버스 설정
let canvas, ctx;

function initializeCanvas() {
    canvas = document.getElementById('gameCanvas');
    if (!canvas) {
        console.error('Canvas element not found');
        return false;
    }
    
    // 캔버스 크기를 컨테이너에 맞게 조정
    const container = canvas.parentElement;
    if (container) {
        const containerWidth = container.offsetWidth - 20; // 패딩 고려
        canvas.width = containerWidth;
        canvas.height = 600; // 높이는 고정
        console.log(`✅ Canvas 크기 조정됨: ${canvas.width} x ${canvas.height}`);
    }
    
    ctx = canvas.getContext('2d');
    return true;
}

// 게임 객체 클래스들
class GameObject {
  constructor(x, y, radius, color, name, type) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.color = color;
    this.name = name;
    this.type = type;
    this.vx = 0;
    this.vy = 0;
    this.targetX = x;
    this.targetY = y;
    this.status = '대기';
    this.energy = 100;
    this.pulse = 0;
    this.cards = 0;
    this.isDragging = false;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
  }
  
  // 비트코인 4각형 클래스
  static createBitcoinSquare(x, y, size, color) {
    return {
      x: x,
      y: y,
      size: size,
      color: color,
      rotation: 0,
      pulse: 0,
      isActive: false,
      draw(ctx) {
        ctx.save();
        
        // 맥박 효과
        this.pulse += 0.05;
        const pulseScale = 1 + Math.sin(this.pulse) * 0.1;
        const scaledSize = this.size * pulseScale;
        
        // 회전
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        
        // 그림자
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 15;
        
        // 4각형 그리기 (다이아몬드 모양)
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.moveTo(0, -scaledSize);
        ctx.lineTo(scaledSize, 0);
        ctx.lineTo(0, scaledSize);
        ctx.lineTo(-scaledSize, 0);
        ctx.closePath();
        ctx.fill();
        
        // 테두리
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // 비트코인 로고 (₿)
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('₿', 0, 0);
        
        ctx.restore();
      },
      
      update() {
        // 천천히 회전
        this.rotation += 0.01;
      }
    };
  }
  
  // N/B 길드 다각형 클래스
  static createNBGuildPolygon(x, y, size, color) {
    return {
      x: x,
      y: y,
      size: size,
      color: color,
      rotation: 0,
      pulse: 0,
      sides: 6, // 6각형
      isActive: false,
      draw(ctx) {
        ctx.save();
        
        // 맥박 효과
        this.pulse += 0.03;
        const pulseScale = 1 + Math.sin(this.pulse) * 0.15;
        const scaledSize = this.size * pulseScale;
        
        // 회전
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        
        // 그림자
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 20;
        
        // 6각형 그리기
        ctx.fillStyle = this.color;
        ctx.beginPath();
        for (let i = 0; i < this.sides; i++) {
          const angle = (i * 2 * Math.PI) / this.sides;
          const px = Math.cos(angle) * scaledSize;
          const py = Math.sin(angle) * scaledSize;
          if (i === 0) {
            ctx.moveTo(px, py);
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.closePath();
        ctx.fill();
        
        // 테두리
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // N/B 로고
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('N/B', 0, 0);
        
        ctx.restore();
      },
      
      update() {
        // 반대 방향으로 회전
        this.rotation -= 0.015;
      }
    };
  }
  
  update() {
    // 부드러운 이동
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    this.x += dx * 0.1;
    this.y += dy * 0.1;
    
    // 마을 이동 기능
    if (this.type === 'mayor' && this.village && this.village.isMoving) {
      // 자동 이동 (원형 경로)
      const time = Date.now() * 0.001;
      const radius = 50;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      
      this.targetX = centerX + Math.cos(time * this.village.moveSpeed) * radius;
      this.targetY = centerY + Math.sin(time * this.village.moveSpeed) * radius;
    }
    
    // 맥박 효과
    this.pulse += 0.1;
    
    // 에너지 감소
    if (this.energy > 0) {
      this.energy -= 0.1;
    }
  }
  
  draw() {
    ctx.save();
    
    // 카드 형태인 주민들
    if (this.type === 'resident' && this.isCard) {
      this.drawCard();
    } else {
      // 기존 구슬 형태 그리기
      const pulseScale = 1 + Math.sin(this.pulse) * 0.1;
      const scaledRadius = this.radius * pulseScale;
      
      // 그림자
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 20;
      
      // 구슬 그리기
      const gradient = ctx.createRadialGradient(
        this.x - scaledRadius * 0.3, this.y - scaledRadius * 0.3, 0,
        this.x, this.y, scaledRadius
      );
      gradient.addColorStop(0, this.color);
      gradient.addColorStop(1, this.darkenColor(this.color, 0.3));
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(this.x, this.y, scaledRadius, 0, Math.PI * 2);
      ctx.fill();
      
      // 테두리
      ctx.strokeStyle = this.lightenColor(this.color, 0.5);
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // 이름 표시
      ctx.fillStyle = '#ffffff';
      if (this.type === 'resident') {
        ctx.font = '8px Arial';
        ctx.fillText(this.name, this.x, this.y + scaledRadius + 12);
        
        // 상태 표시
        ctx.fillStyle = this.getStatusColor();
        ctx.font = '6px Arial';
        ctx.fillText(this.status, this.x, this.y + scaledRadius + 20);
      } else if (this.type === 'mayor') {
        ctx.font = '12px Arial';
        ctx.fillText(this.name, this.x, this.y + scaledRadius + 20);
        
        // 마을 정보 표시
        if (this.village) {
          ctx.fillStyle = '#DEB887';
          ctx.font = '10px Arial';
          ctx.fillText(`촌장: ${this.village.mayor}명 | 주민: ${this.village.residents}명 | 창고: ${this.village.warehouse}개`, this.x, this.y + scaledRadius + 35);
        }
        
        // 창고 정보 표시
        if (this.warehouse) {
          ctx.fillStyle = '#00d1ff';
          ctx.font = '10px Arial';
          ctx.fillText(`창고: ${this.warehouse.cards}/${this.warehouse.capacity}`, this.x, this.y + scaledRadius + 50);
          
          // 창고 상태 표시
          ctx.fillStyle = this.warehouse.isOpen ? '#0ecb81' : '#6c757d';
          ctx.font = '8px Arial';
          ctx.fillText(this.warehouse.isOpen ? '열림' : '닫힘', this.x, this.y + scaledRadius + 60);
        }
      } else {
        ctx.font = '12px Arial';
        ctx.fillText(this.name, this.x, this.y + scaledRadius + 20);
        
        // 상태 표시
        ctx.fillStyle = this.getStatusColor();
        ctx.font = '10px Arial';
        ctx.fillText(this.status, this.x, this.y + scaledRadius + 35);
      }
      
      // 카드 수 표시 (구슬 형태일 때만)
      if (this.cards > 0) {
        ctx.fillStyle = '#00d1ff';
        if (this.type === 'resident') {
          ctx.font = 'bold 8px Arial';
          ctx.fillText(`${this.cards}`, this.x, this.y - scaledRadius - 6);
        } else {
          ctx.font = 'bold 14px Arial';
          ctx.fillText(`${this.cards}`, this.x, this.y - scaledRadius - 10);
        }
      }
    }
    
    ctx.restore();
  }
  
  isPointInside(x, y) {
    const distance = Math.sqrt((x - this.x) ** 2 + (y - this.y) ** 2);
    return distance <= this.radius;
  }
  
  getStatusColor() {
    switch (this.status) {
      case '활성': return '#00ff00';
      case '분석중': return '#00d1ff';
      case '거래중': return '#ff6b6b';
      case '완료': return '#4ecdc4';
      case '실패': return '#ff4757';
      default: return '#888888';
    }
  }
  
  lightenColor(color, amount) {
    const num = parseInt(color.replace("#", ""), 16);
    const amt = Math.round(2.55 * amount * 100);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
      (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
      (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
  }
  
  darkenColor(color, amount) {
    const num = parseInt(color.replace("#", ""), 16);
    const amt = Math.round(2.55 * amount * 100);
    const R = (num >> 16) - amt;
    const G = (num >> 8 & 0x00FF) - amt;
    const B = (num & 0x0000FF) - amt;
    return "#" + (0x1000000 + (R > 255 ? 255 : R < 0 ? 0 : R) * 0x10000 +
      (G > 255 ? 255 : G < 0 ? 0 : G) * 0x100 +
      (B > 255 ? 255 : B < 0 ? 0 : B)).toString(16).slice(1);
  }
  
  // 카드 그리기 함수
  drawCard() {
    const cardWidth = 80;
    const cardHeight = 120;
    
    // 카드 배경 (금색 테두리)
    ctx.fillStyle = '#1e2329';
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 3;
    ctx.fillRect(this.x - cardWidth/2, this.y - cardHeight/2, cardWidth, cardHeight);
    ctx.strokeRect(this.x - cardWidth/2, this.y - cardHeight/2, cardWidth, cardHeight);
    
    // 상단 원형 아이콘 (색상별)
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y - cardHeight/2 + 15, 8, 0, Math.PI * 2);
    ctx.fill();
    
    // 캐릭터 이름
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(this.name, this.x, this.y - 20);
    
    // 레벨 표시
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 12px Arial';
    ctx.fillText(`레벨: ${this.level}`, this.x, this.y + 10);
    
    // 상태 표시
    ctx.fillStyle = this.getStatusColor();
    ctx.font = '8px Arial';
    ctx.fillText(this.status, this.x, this.y + 25);
    
    // 카드 수 표시
    if (this.cards > 0) {
      ctx.fillStyle = '#00d1ff';
      ctx.font = 'bold 14px Arial';
      ctx.fillText(`${this.cards}`, this.x, this.y + 40);
    }
    
    // 경험치 바 (노란색)
    const expBarWidth = 60;
    const expBarHeight = 4;
    const expBarX = this.x - expBarWidth/2;
    const expBarY = this.y + cardHeight/2 - 15;
    
    // 경험치 바 배경
    ctx.fillStyle = '#333333';
    ctx.fillRect(expBarX, expBarY, expBarWidth, expBarHeight);
    
    // 경험치 바 채움 (랜덤)
    const expPercent = Math.random() * 100;
    ctx.fillStyle = '#ffff00';
    ctx.fillRect(expBarX, expBarY, (expBarWidth * expPercent) / 100, expBarHeight);
  }
}

// 게임 초기화
function initGame() {
  // 기존 객체들 제거
  gameObjects = [];
  
  // 캔버스 크기에 맞게 위치 계산
  const canvasWidth = canvas.width;
  const canvasHeight = canvas.height;
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  
  // 마을 (중앙, 마을 형태)
  const mayor = new GameObject(centerX, centerY, 25, '#ffb703', '마을', 'mayor');
  mayor.status = '활성';
  mayor.energy = 100;
  mayor.warehouse = {
    cards: 0,
    capacity: 100,
    items: [],
    isOpen: false
  };
  mayor.village = {
    mayor: 1,
    residents: 4,
    warehouse: 1,
    isNight: false,
    isMoving: false,
    moveSpeed: 0.5,
    targetX: mayor.x,
    targetY: mayor.y
  };
  gameObjects.push(mayor);
  
  // 4명의 마을 주민 (원래 구슬 형태)
  const residentNames = ['Scout', 'Analyst', 'Guardian', 'Elder'];
  const residentColors = ['#00d1ff', '#0ecb81', '#ff6b6b', '#a855f7'];
  
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI * 2) / 4;
    const distance = 80;
    const residentX = centerX + Math.cos(angle) * distance;
    const residentY = centerY + Math.sin(angle) * distance;
    
    const resident = new GameObject(residentX, residentY, 15, residentColors[i], residentNames[i], 'resident');
    resident.status = '대기';
    gameObjects.push(resident);
  }
  
  // 비트코인 센터 4각형 (왼쪽 상단)
  bitcoinSquare = GameObject.createBitcoinSquare(centerX - 400, centerY - 250, 40, '#f7931a');
  bitcoinSquare.isActive = false;
  
  // N/B 길드 다각형 (우측 중앙) - 캔버스 크기에 맞게 조정
  const nbGuildX = Math.min(canvasWidth - 100, centerX + 400); // 우측 여백 100px 확보
  nbGuildPolygon = GameObject.createNBGuildPolygon(nbGuildX, centerY, 35, '#00d1ff');
  nbGuildPolygon.isActive = false;
  
  // 마우스 이벤트 설정
  setupMouseEvents();
  
  console.log('🏛️ N/B 길드 엔진 초기화 완료');
}

// 마우스 이벤트 설정
function setupMouseEvents() {
  let selectedObject = null;
  
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    for (let obj of gameObjects) {
      if (obj.isPointInside(x, y)) {
        selectedObject = obj;
        obj.isDragging = true;
        obj.dragOffsetX = x - obj.x;
        obj.dragOffsetY = y - obj.y;
        break;
      }
    }
  });
  
  canvas.addEventListener('mousemove', (e) => {
    if (selectedObject && selectedObject.isDragging) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      selectedObject.targetX = x - selectedObject.dragOffsetX;
      selectedObject.targetY = y - selectedObject.dragOffsetY;
    }
  });
  
  canvas.addEventListener('mouseup', () => {
    if (selectedObject) {
      selectedObject.isDragging = false;
      selectedObject = null;
    }
  });
}

// 게임 루프
function gameLoop() {
  if (!gameRunning) return;
  
  // 캔버스 클리어
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // 배경 그라데이션
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#0b1220');
  gradient.addColorStop(1, '#1e2329');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // 연결선 그리기
  drawConnections();
  
  // 게임 객체들 업데이트 및 그리기
  for (let obj of gameObjects) {
    obj.update();
    obj.draw();
  }
  
  // 비트코인 4각형 업데이트 및 그리기
  if (bitcoinSquare) {
    bitcoinSquare.update();
    bitcoinSquare.draw(ctx);
  }
  
  // N/B 길드 다각형 업데이트 및 그리기
  if (nbGuildPolygon) {
    nbGuildPolygon.update();
    nbGuildPolygon.draw(ctx);
  }
  
  // 카드 효과 그리기
  drawCardEffects();
  
  // 마을 내부 창고 그리기
  drawMayorWarehouse();
  
  // 마을 그리기
  drawVillage();
  
  // N/B 길드 시스템 레이아웃 그리기
  drawNBGuildSystemLayout();
  
  // N/B 길드 시스템 텍스트 그리기
  drawNBGuildSystemText();
  
  // UI 업데이트
  updateGameUI();
  
  animationId = requestAnimationFrame(gameLoop);
}

// 연결선 그리기 (촌장과 주민들, N/B 길드 연결)
function drawConnections() {
  const mayor = gameObjects.find(obj => obj.type === 'mayor');
  if (!mayor) return;
  
  // 촌장과 주민들 연결
  ctx.strokeStyle = 'rgba(255, 183, 3, 0.3)';
  ctx.lineWidth = 2;
  
  for (let obj of gameObjects) {
    if (obj.type === 'resident') {
      ctx.beginPath();
      ctx.moveTo(mayor.x, mayor.y);
      ctx.lineTo(obj.x, obj.y);
      ctx.stroke();
    }
  }
  
  // 마을이 이동할 때 주민들도 따라가도록
  if (mayor.village && mayor.village.isMoving) {
    const residents = gameObjects.filter(obj => obj.type === 'resident');
    residents.forEach((resident, index) => {
      const angle = (index * Math.PI * 2) / residents.length;
      const distance = 80;
      resident.targetX = mayor.x + Math.cos(angle) * distance;
      resident.targetY = mayor.y + Math.sin(angle) * distance;
    });
  }
  
  // 촌장과 N/B 길드 연결
  if (nbGuildPolygon) {
    ctx.strokeStyle = 'rgba(0, 209, 255, 0.4)';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 4]);
    
    ctx.beginPath();
    ctx.moveTo(mayor.x, mayor.y);
    ctx.lineTo(nbGuildPolygon.x, nbGuildPolygon.y);
    ctx.stroke();
    
    ctx.setLineDash([]); // 점선 초기화
  }
  
  // 비트코인 센터는 독립적이므로 연결선 없음
}

// 카드 효과 그리기
function drawCardEffects() {
  for (let obj of gameObjects) {
    if (obj.cards > 0) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#00d1ff';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);
      
      const radius = obj.radius + 10 + Math.sin(Date.now() * 0.005) * 5;
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      
      ctx.restore();
    }
  }
  
  // 비트코인 4각형 특별 효과
  if (bitcoinSquare) {
    ctx.save();
    
    if (bitcoinSquare.isActive) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#f7931a';
      ctx.lineWidth = 6;
      ctx.setLineDash([15, 5]);
    } else {
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
    }
    
    const effectSize = bitcoinSquare.size + 20 + Math.sin(Date.now() * 0.003) * 10;
    ctx.translate(bitcoinSquare.x, bitcoinSquare.y);
    ctx.rotate(bitcoinSquare.rotation);
    
    ctx.beginPath();
    ctx.moveTo(0, -effectSize);
    ctx.lineTo(effectSize, 0);
    ctx.lineTo(0, effectSize);
    ctx.lineTo(-effectSize, 0);
    ctx.closePath();
    ctx.stroke();
    
    ctx.restore();
  }
  
  // N/B 길드 다각형 특별 효과
  if (nbGuildPolygon) {
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = '#00d1ff';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    
    const effectSize = nbGuildPolygon.size + 15 + Math.sin(Date.now() * 0.004) * 8;
    ctx.translate(nbGuildPolygon.x, nbGuildPolygon.y);
    ctx.rotate(nbGuildPolygon.rotation);
    
    // 6각형 효과
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * 2 * Math.PI) / 6;
      const px = Math.cos(angle) * effectSize;
      const py = Math.sin(angle) * effectSize;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.stroke();
    
    ctx.restore();
  }
}

// 마을 내부 창고 그리기
function drawMayorWarehouse() {
  const mayor = gameObjects.find(obj => obj.type === 'mayor');
  if (!mayor || !mayor.warehouse) return;
  
  ctx.save();
  
  // 창고 내부 영역 (마을 내부)
  const warehouseRadius = mayor.radius * 0.4;
  
  // 창고 배경
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#1e2329';
  ctx.beginPath();
  ctx.arc(mayor.x, mayor.y, warehouseRadius, 0, Math.PI * 2);
  ctx.fill();
  
  // 창고 테두리
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = mayor.warehouse.isOpen ? '#0ecb81' : '#6c757d';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(mayor.x, mayor.y, warehouseRadius, 0, Math.PI * 2);
  ctx.stroke();
  
  // 창고 아이템들 표시
  if (mayor.warehouse.cards > 0) {
    const itemCount = Math.min(mayor.warehouse.cards, 6); // 최대 6개만 표시
    const angleStep = (Math.PI * 2) / itemCount;
    const itemRadius = warehouseRadius * 0.2;
    
    for (let i = 0; i < itemCount; i++) {
      const angle = i * angleStep + Date.now() * 0.001;
      const x = mayor.x + Math.cos(angle) * itemRadius;
      const y = mayor.y + Math.sin(angle) * itemRadius;
      
      // 작은 카드 아이콘
      ctx.fillStyle = '#00d1ff';
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x - 1.5, y - 2, 3, 4);
      
      // 카드 테두리
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x - 1.5, y - 2, 3, 4);
    }
  }
  
  // 창고 문 표시
  if (mayor.warehouse.isOpen) {
    ctx.fillStyle = '#0ecb81';
    ctx.globalAlpha = 0.6;
    ctx.fillRect(mayor.x - 6, mayor.y - warehouseRadius + 3, 12, 6);
  }
  
  ctx.restore();
}

// 마을 그리기
function drawVillage() {
  const mayor = gameObjects.find(obj => obj.type === 'mayor');
  if (!mayor || !mayor.village) return;
  
  ctx.save();
  
  // 마을 배경 (땅)
  ctx.fillStyle = '#8B4513';
  ctx.globalAlpha = 0.8;
  ctx.fillRect(mayor.x - mayor.radius, mayor.y + mayor.radius * 0.3, mayor.radius * 2, mayor.radius * 0.7);
  
  // 촌장 집 (중앙, 가장 큰 집)
  const mayorHouseX = mayor.x;
  const mayorHouseY = mayor.y + mayor.radius * 0.4;
  
  // 촌장 집 지붕
  ctx.fillStyle = '#8B0000';
  ctx.beginPath();
  ctx.moveTo(mayorHouseX - 6, mayorHouseY);
  ctx.lineTo(mayorHouseX, mayorHouseY - 8);
  ctx.lineTo(mayorHouseX + 6, mayorHouseY);
  ctx.closePath();
  ctx.fill();
  
  // 촌장 집 벽
  ctx.fillStyle = '#DEB887';
  ctx.fillRect(mayorHouseX - 4, mayorHouseY, 8, 10);
  
  // 촌장 집 창문
  ctx.fillStyle = '#87CEEB';
  ctx.fillRect(mayorHouseX - 2, mayorHouseY + 2, 4, 3);
  
  // 촌장 집 문
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(mayorHouseX - 1, mayorHouseY + 7, 2, 3);
  
  // 주민들 집 그리기 (4개)
  const residentCount = mayor.village.residents;
  const houseSpacing = (mayor.radius * 1.4) / (residentCount + 1);
  
  for (let i = 0; i < residentCount; i++) {
    const houseX = mayor.x - mayor.radius * 0.7 + (i + 1) * houseSpacing;
    const houseY = mayor.y + mayor.radius * 0.4;
    
    // 주민 집 지붕
    ctx.fillStyle = '#8B0000';
    ctx.beginPath();
    ctx.moveTo(houseX - 3, houseY);
    ctx.lineTo(houseX, houseY - 5);
    ctx.lineTo(houseX + 3, houseY);
    ctx.closePath();
    ctx.fill();
    
    // 주민 집 벽
    ctx.fillStyle = '#DEB887';
    ctx.fillRect(houseX - 2, houseY, 4, 6);
    
    // 주민 집 창문
    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(houseX - 1, houseY + 1, 2, 2);
    
    // 주민 집 문
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(houseX - 1, houseY + 4, 2, 2);
  }
  
  // 창고 그리기 (1개)
  const warehouseX = mayor.x;
  const warehouseY = mayor.y + mayor.radius * 0.2;
  
  // 창고 건물
  ctx.fillStyle = '#696969';
  ctx.fillRect(warehouseX - 6, warehouseY, 12, 14);
  
  // 창고 창문들
  ctx.fillStyle = mayor.warehouse.isOpen ? '#0ecb81' : '#FFD700';
  for (let j = 0; j < 2; j++) {
    for (let k = 0; k < 3; k++) {
      ctx.fillRect(warehouseX - 5 + j * 8, warehouseY + 2 + k * 3, 3, 3);
    }
  }
  
  // 창고 문
  ctx.fillStyle = mayor.warehouse.isOpen ? '#0ecb81' : '#8B4513';
  ctx.fillRect(warehouseX - 2, warehouseY + 10, 4, 4);
  
  // 나무들
  for (let i = 0; i < 3; i++) {
    const treeX = mayor.x - mayor.radius * 0.9 + i * 8;
    const treeY = mayor.y + mayor.radius * 0.5;
    
    // 나무 잎
    ctx.fillStyle = '#228B22';
    ctx.beginPath();
    ctx.arc(treeX, treeY - 3, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // 나무 줄기
    ctx.fillStyle = '#8B4513';
    ctx.fillRect(treeX - 1, treeY, 2, 4);
  }
  
  // 길
  ctx.strokeStyle = '#D2B48C';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mayor.x - mayor.radius * 0.8, mayor.y + mayor.radius * 0.6);
  ctx.lineTo(mayor.x + mayor.radius * 0.8, mayor.y + mayor.radius * 0.6);
  ctx.stroke();
  
  // 마을 이동 시 이동 궤적 표시
  if (mayor.village && mayor.village.isMoving) {
    ctx.strokeStyle = 'rgba(255, 183, 3, 0.2)';
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    
    const time = Date.now() * 0.001;
    const radius = 50;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    ctx.beginPath();
    for (let i = 0; i < 50; i++) {
      const t = time - i * 0.1;
      const x = centerX + Math.cos(t * mayor.village.moveSpeed) * radius;
      const y = centerY + Math.sin(t * mayor.village.moveSpeed) * radius;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  
  ctx.restore();
}

// N/B 길드 시스템 레이아웃 그리기
function drawNBGuildSystemLayout() {
  ctx.save();
  
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  
  // 레이아웃 배경 (반투명 사각형)
  const layoutWidth = 300;
  const layoutHeight = 80;
  const layoutX = centerX - layoutWidth / 2;
  const layoutY = centerY - 20; // 텍스트 위에 배치
  
  // 배경 그라데이션
  const gradient = ctx.createLinearGradient(layoutX, layoutY, layoutX, layoutY + layoutHeight);
  gradient.addColorStop(0, 'rgba(0, 209, 255, 0.1)');
  gradient.addColorStop(1, 'rgba(0, 209, 255, 0.05)');
  
  ctx.fillStyle = gradient;
  ctx.fillRect(layoutX, layoutY, layoutWidth, layoutHeight);
  
  // 테두리
  ctx.strokeStyle = 'rgba(0, 209, 255, 0.3)';
  ctx.lineWidth = 2;
  ctx.strokeRect(layoutX, layoutY, layoutWidth, layoutHeight);
  
  // 내부 장식 요소들
  ctx.fillStyle = 'rgba(0, 209, 255, 0.2)';
  
  // 왼쪽 원형 장식
  ctx.beginPath();
  ctx.arc(layoutX + 20, layoutY + layoutHeight / 2, 8, 0, Math.PI * 2);
  ctx.fill();
  
  // 오른쪽 원형 장식
  ctx.beginPath();
  ctx.arc(layoutX + layoutWidth - 20, layoutY + layoutHeight / 2, 8, 0, Math.PI * 2);
  ctx.fill();
  
  // 중앙 선형 장식
  ctx.strokeStyle = 'rgba(0, 209, 255, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(layoutX + 40, layoutY + layoutHeight / 2);
  ctx.lineTo(layoutX + layoutWidth - 40, layoutY + layoutHeight / 2);
  ctx.stroke();
  ctx.setLineDash([]);
  
  // 작은 장식 점들
  ctx.fillStyle = 'rgba(0, 209, 255, 0.6)';
  for (let i = 0; i < 5; i++) {
    const dotX = layoutX + 60 + (i * 45);
    const dotY = layoutY + layoutHeight / 2;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.restore();
}

// N/B 길드 시스템 텍스트 그리기
function drawNBGuildSystemText() {
  ctx.save();
  
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  
  // N/B 길드 시스템 텍스트
  ctx.fillStyle = '#00d1ff';
  ctx.font = 'bold 24px Arial';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#00d1ff';
  ctx.shadowBlur = 10;
  ctx.fillText('N/B 길드 시스템', centerX, centerY + 50);
  
  ctx.restore();
}

// 게임 UI 업데이트
function updateGameUI() {
  const mayor = gameObjects.find(obj => obj.type === 'mayor');
  const residents = gameObjects.filter(obj => obj.type === 'resident');
  
  if (mayor) {
    document.getElementById('mayorStatus').textContent = mayor.status;
    document.getElementById('mayorStatus').className = `text-${getStatusClass(mayor.status)}`;
  }
  
  residents.forEach((resident, index) => {
    const statusElement = document.getElementById(`resident${index + 1}Status`);
    if (statusElement) {
      statusElement.textContent = resident.status;
      statusElement.className = `text-${getStatusClass(resident.status)}`;
    }
  });
  
  // 통계 업데이트
  const totalCards = gameObjects.reduce((sum, obj) => sum + obj.cards, 0);
  const activeCards = gameObjects.filter(obj => obj.status === '분석중' || obj.status === '거래중').length;
  const completedCards = gameObjects.filter(obj => obj.status === '완료').length;
  const failedCards = gameObjects.filter(obj => obj.status === '실패').length;
  
  document.getElementById('totalCards').textContent = totalCards;
  document.getElementById('activeCards').textContent = activeCards;
  document.getElementById('completedCards').textContent = completedCards;
  document.getElementById('failedCards').textContent = failedCards;
  
  // N/B 길드 정보 업데이트
  updateNBGuildInfo();
  
  // 초기 N/B Zone Strip 업데이트 (즉시 실행)
  updateNBZoneStrip('ORANGE');
}

// 통계 함수들
function getTotalCards() {
  return gameObjects.reduce((total, obj) => total + obj.cards, 0);
}

function getActiveCards() {
  return gameObjects.filter(obj => obj.status === '분석중' || obj.status === '거래중').length;
}

function getCompletedCards() {
  return gameObjects.filter(obj => obj.status === '완료').length;
}

function getFailedCards() {
  return gameObjects.filter(obj => obj.status === '실패').length;
}

function updateGameStats() {
  const totalCards = getTotalCards();
  const activeCards = getActiveCards();
  const completedCards = getCompletedCards();
  const failedCards = getFailedCards();
  
  // DOM 업데이트 (안전하게 처리)
  const elements = {
    'totalCards': totalCards,
    'activeCards': activeCards,
    'completedCards': completedCards,
    'failedCards': failedCards
  };
  
  Object.keys(elements).forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = elements[id];
    }
  });
  
  // 길드원 상태 업데이트 (안전하게 처리)
  const mayor = gameObjects.find(obj => obj.type === 'mayor');
  const residents = gameObjects.filter(obj => obj.type === 'resident');
  
  if (mayor) {
    const mayorElement = document.getElementById('mayorStatus');
    if (mayorElement) {
      mayorElement.textContent = mayor.status;
    }
  }
  
  residents.forEach((resident, index) => {
    const elementId = `resident${index + 1}Status`;
    const element = document.getElementById(elementId);
    if (element) {
      element.textContent = resident.status;
    }
  });
}

// 시뮬레이션 함수들
function simulateCardCreation() {
  const residents = gameObjects.filter(obj => obj.type === 'resident');
  const randomResident = residents[Math.floor(Math.random() * residents.length)];
  
  if (randomResident && randomResident.status === '대기') {
    randomResident.cards++;
    randomResident.status = '분석중';
    
    // 3초 후 상태 변경
    setTimeout(() => {
      if (Math.random() > 0.3) {
        randomResident.status = '완료';
        randomResident.cards--;
        
        // 성공한 카드를 창고에 추가
        const mayor = gameObjects.find(obj => obj.type === 'mayor');
        if (mayor && mayor.warehouse && mayor.warehouse.isOpen) {
          if (mayor.warehouse.cards < mayor.warehouse.capacity) {
            mayor.warehouse.cards++;
          }
        }
      } else {
        randomResident.status = '실패';
        randomResident.cards--;
      }
      
      // 2초 후 대기 상태로 복귀
      setTimeout(() => {
        randomResident.status = '대기';
      }, 2000);
    }, 3000);
  }
}

// 주기적 시뮬레이션
setInterval(simulateCardCreation, 5000);

// N/B 길드 정보 업데이트
async function updateNBGuildInfo() {
  try {
    const nbData = await getNBGuildData();
    
    document.getElementById('nbProfit').textContent = nbData.profit;
    document.getElementById('nbLoss').textContent = nbData.loss;
    document.getElementById('nbAutoTrade').textContent = nbData.autoTrade;
    document.getElementById('nbTrustLevel').textContent = nbData.trustLevel;
    document.getElementById('mlTrust').textContent = nbData.mlTrust;
    document.getElementById('nbGuildTrust').textContent = nbData.nbGuildTrust;
    document.getElementById('trustBalance').textContent = nbData.trustBalance;
    
    // N/B Zone Status는 차트에서 직접 가져오기 (refreshNbZoneStrip 함수 사용)
    try {
      // ui.js의 refreshNbZoneStrip 함수 호출 - 전역 함수 우선 확인
      if (typeof window.refreshNbZoneStrip === 'function') {
        await window.refreshNbZoneStrip();
      } else if (typeof refreshNbZoneStrip === 'function') {
        await refreshNbZoneStrip();
      } else {
        // 함수가 없으면 직접 N/B Zone Status 업데이트
        updateNBZoneStatusDirectly();
      }
    } catch (error) {
      console.log('N/B Zone Status 업데이트 실패:', error);
      // 오류 발생 시 직접 업데이트 시도
      updateNBZoneStatusDirectly();
    }
  } catch (error) {
    console.log('N/B 길드 정보 업데이트 실패:', error);
  }
}

// N/B Zone Strip 업데이트 함수
function updateNBZoneStrip(zone) {
  try {
    const zoneStrip = document.getElementById('nbZoneStrip');
    if (!zoneStrip) return;
    
    // Zone에 따른 색상 설정
    let zoneColor = '#ffb703'; // ORANGE
    let zoneText = 'ORANGE';
    
    if (zone === 'BLUE') {
      zoneColor = '#00d1ff';
      zoneText = 'BLUE';
    } else if (zone === 'NONE') {
      zoneColor = '#888888';
      zoneText = 'NONE';
    }
    
    // Zone Strip 내용 업데이트
    zoneStrip.innerHTML = `
      <div style="width: 100%; height: 100%; background: ${zoneColor}; border-radius: 4px; display: flex; align-items: center; justify-content: center;">
        <span style="color: #000; font-size: 10px; font-weight: bold;">${zoneText}</span>
      </div>
    `;
    
  } catch (error) {
    console.log('N/B Zone Strip 업데이트 실패:', error);
  }
}

// N/B 길드 데이터 가져오기
async function getNBGuildData() {
  try {
    // 서버에서 N/B 길드 데이터 가져오기
    const response = await fetch('/api/village/nb-guild-status');
    if (response.ok) {
      const data = await response.json();
      return {
        profit: data.profit || '0.0%',
        loss: data.loss || '100.0%',
        autoTrade: data.autoTrade || '100%',
        trustLevel: data.trustLevel || 'N/B Favored',
        mlTrust: data.mlTrust || '40%',
        nbGuildTrust: data.nbGuildTrust || '82%',
        trustBalance: data.trustBalance || 'ML: 40% | N/B: 82%',
        zoneStatus: data.zoneStatus || '5m ORANGE',
      };
    }
  } catch (error) {
    console.log('N/B 길드 데이터 가져오기 실패:', error);
  }
  
  // 기본값 반환
  return {
    profit: '0.0%',
    loss: '100.0%',
    autoTrade: '100%',
    trustLevel: 'N/B Favored',
    mlTrust: '40%',
    nbGuildTrust: '82%',
    trustBalance: 'ML: 40% | N/B: 82%',
    zoneStatus: '5m ORANGE',
  };
}

// 상태 클래스 반환
function getStatusClass(status) {
  switch (status) {
    case '활성': return 'warning';
    case '분석중': return 'info';
    case '거래중': return 'success';
    case '완료': return 'success';
    case '실패': return 'danger';
    default: return 'secondary';
  }
}

// 게임 제어 함수들
function resetGame() {
  initGame();
  console.log('🔄 게임 리셋됨');
}

function toggleGame() {
  gameRunning = !gameRunning;
  const button = document.querySelector('button[onclick="toggleGame()"]');
  
  if (gameRunning) {
    button.innerHTML = '⏸️ 일시정지';
    button.className = 'btn btn-success btn-sm';
    gameLoop();
  } else {
    button.innerHTML = '▶️ 재개';
    button.className = 'btn btn-warning btn-sm';
    cancelAnimationFrame(animationId);
  }
}

// N/B 길드와 비트코인 토글 함수들
function toggleNBGuild() {
  if (nbGuildPolygon) {
    nbGuildPolygon.isActive = !nbGuildPolygon.isActive;
    const button = document.querySelector('button[onclick="toggleNBGuild()"]');
    
    if (nbGuildPolygon.isActive) {
      button.innerHTML = '🏛️ N/B 길드 (활성)';
      button.className = 'btn btn-success btn-sm me-2';
      console.log('🏛️ N/B 길드 활성화됨');
    } else {
      button.innerHTML = '🏛️ N/B 길드';
      button.className = 'btn btn-primary btn-sm me-2';
      console.log('🏛️ N/B 길드 비활성화됨');
    }
  }
}

function toggleBitcoin() {
  if (bitcoinSquare) {
    bitcoinSquare.isActive = !bitcoinSquare.isActive;
    const button = document.querySelector('button[onclick="toggleBitcoin()"]');
    
    if (bitcoinSquare.isActive) {
      button.innerHTML = '₿ 비트코인 (활성)';
      button.className = 'btn btn-success btn-sm me-2';
      console.log('₿ 비트코인 센터 활성화됨');
    } else {
      button.innerHTML = '₿ 비트코인';
      button.className = 'btn btn-warning btn-sm me-2';
      console.log('₿ 비트코인 센터 비활성화됨');
    }
  }
}

function toggleMovingVillage() {
  const mayor = gameObjects.find(obj => obj.type === 'mayor');
  if (mayor && mayor.village) {
    mayor.village.isMoving = !mayor.village.isMoving;
    const button = document.querySelector('button[onclick="toggleMovingVillage()"]');
    
    if (mayor.village.isMoving) {
      button.innerHTML = '🚶 이동하는 마을 (활성)';
      button.className = 'btn btn-success btn-sm';
      console.log('🚶 이동하는 마을 활성화됨');
    } else {
      button.innerHTML = '🚶 이동하는 마을';
      button.className = 'btn btn-success btn-sm';
      console.log('🚶 이동하는 마을 비활성화됨');
    }
  }
}

// 게임 초기화 함수
function initGameSystem() {
  if (!initializeCanvas()) {
    console.error('Canvas initialization failed');
    return;
  }
  
  // 게임 시작
  initGame();
  gameLoop();
  
  // 주기적 통계 업데이트
  setInterval(updateGameStats, 2000);
  
  console.log('🃏 Guild Members Card System - N/B 길드 엔진 완료');
  
  // 3초 후 마을 에너지 자동 충전
  setTimeout(() => {
    chargeGameEnergy();
    
    // 마을 에너지 100% 버튼도 클릭
    if (typeof window.clickVillageEnergyButton === 'function') {
      window.clickVillageEnergyButton();
    }
  }, 3000);
}

// 게임 내 마을 에너지 충전 함수
function chargeGameEnergy() {
  try {
    console.log('⚡ Auto-charging game village energy...');
    
    // 게임 객체들에서 마을(Mayor) 찾기
    const mayor = gameObjects.find(obj => obj.type === 'mayor');
    if (mayor) {
      mayor.energy = 100;
      console.log('✅ 게임 마을 에너지 충전됨 (100)');
    }
    
    // 마을 이동 활성화
    if (mayor && mayor.village) {
      mayor.village.isMoving = true;
      console.log('✅ 게임 마을 이동 활성화됨');
    }
    
    console.log('⚡ 게임 마을 에너지 자동 충전 완료');
  } catch (error) {
    console.error('❌ 게임 마을 에너지 충전 중 오류:', error);
  }
}

// 전역 함수로 노출
window.initGameSystem = initGameSystem;
