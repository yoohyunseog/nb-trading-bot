// ===== SPA Router System =====

class AppRouter {
  constructor() {
    this.routes = {
      '/': { title: 'Dashboard', component: 'dashboard' },
      '/guild': { title: 'Guild Members Card System', component: 'guild' },
      '/trading': { title: 'Trading Dashboard', component: 'trading' },
      '/village': { title: 'Village System', component: 'village' },
      '/settings': { title: 'Settings', component: 'settings' }
    };
    
    this.currentRoute = '/';
    this.init();
  }
  
  init() {
    // 브라우저 뒤로가기/앞으로가기 지원
    window.addEventListener('popstate', (e) => {
      this.navigate(window.location.pathname, false);
    });
    
    // 초기 라우트 설정
    const path = window.location.pathname;
    if (this.routes[path]) {
      this.navigate(path, false);
    } else {
      this.navigate('/', false);
    }
    
    // 네비게이션 이벤트 리스너
    this.setupNavigation();
  }
  
  setupNavigation() {
    // 네비게이션 링크 클릭 이벤트
    document.addEventListener('click', (e) => {
      if (e.target.matches('[data-route]')) {
        e.preventDefault();
        const route = e.target.getAttribute('data-route');
        this.navigate(route);
      }
    });
  }
  
  async navigate(path, updateHistory = true) {
    if (!this.routes[path]) {
      path = '/';
    }
    
    const route = this.routes[path];
    this.currentRoute = path;
    
    // 브라우저 히스토리 업데이트
    if (updateHistory) {
      window.history.pushState({}, route.title, path);
    }
    
    // 페이지 제목 업데이트
    document.title = `8BIT - ${route.title}`;
    
    // 네비게이션 활성 상태 업데이트
    this.updateNavigation();
    
    // 컴포넌트 로드 및 렌더링
    await this.loadComponent(route.component);
    
    // 차트 동기화 (필요한 경우)
    this.syncChartData();
  }
  
  updateNavigation() {
    // 모든 네비게이션 링크에서 active 클래스 제거
    document.querySelectorAll('[data-route]').forEach(link => {
      link.classList.remove('active');
    });
    
    // 현재 라우트에 active 클래스 추가
    const currentLink = document.querySelector(`[data-route="${this.currentRoute}"]`);
    if (currentLink) {
      currentLink.classList.add('active');
    }
  }
  
  async loadComponent(componentName) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;
    
    // 로딩 상태 표시
    mainContent.innerHTML = `
      <div class="loading-container">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
        <p class="mt-3">Loading ${componentName}...</p>
      </div>
    `;
    
    try {
      switch (componentName) {
        case 'dashboard':
          await this.loadDashboard();
          break;
        case 'guild':
          await this.loadGuildSystem();
          break;
        case 'trading':
          await this.loadTradingDashboard();
          break;
        case 'village':
          await this.loadVillageSystem();
          break;
        case 'settings':
          await this.loadSettings();
          break;
        default:
          await this.loadDashboard();
      }
    } catch (error) {
      console.error('Component loading error:', error);
      mainContent.innerHTML = `
        <div class="error-container">
          <h3>Error Loading Component</h3>
          <p>${error.message}</p>
          <button class="btn btn-primary" onclick="window.location.reload()">Reload</button>
        </div>
      `;
    }
  }
  
  async loadDashboard() {
    const mainContent = document.getElementById('main-content');
    mainContent.innerHTML = `
      <div class="dashboard-container">
        <div class="row">
          <div class="col-md-6">
            <div class="card">
              <div class="card-header">
                <h5>📊 Quick Stats</h5>
              </div>
              <div class="card-body">
                <div class="row">
                  <div class="col-6">
                    <div class="stat-item">
                      <div class="stat-value" id="quickProfit">0.0%</div>
                      <div class="stat-label">Profit</div>
                    </div>
                  </div>
                  <div class="col-6">
                    <div class="stat-item">
                      <div class="stat-value" id="quickZone">ORANGE</div>
                      <div class="stat-label">Current Zone</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="col-md-6">
            <div class="card">
              <div class="card-header">
                <h5>🏛️ Village Status</h5>
              </div>
              <div class="card-body">
                <div class="village-status">
                  <div class="status-item">
                    <span class="status-label">Mayor:</span>
                    <span class="status-value" id="mayorStatus">Active</span>
                  </div>
                  <div class="status-item">
                    <span class="status-label">Energy:</span>
                    <span class="status-value" id="villageEnergy">100%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="row mt-4">
          <div class="col-12">
            <div class="card">
              <div class="card-header">
                <h5>🎯 Quick Actions</h5>
              </div>
              <div class="card-body">
                <div class="quick-actions">
                  <button class="btn btn-primary me-2" data-route="/trading">
                    📈 Trading Dashboard
                  </button>
                  <button class="btn btn-success me-2" data-route="/guild">
                    🃏 Guild System
                  </button>
                  <button class="btn btn-info me-2" data-route="/village">
                    🏰 Village System
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // 대시보드 데이터 업데이트
    this.updateDashboardData();
  }
  
  async loadGuildSystem() {
    const mainContent = document.getElementById('main-content');
    mainContent.innerHTML = `
      <div class="guild-system-container">
        <div class="row">
          <div class="col-12">
            <div class="card">
              <div class="card-header">
                <h5>🃏 Guild Members Card System</h5>
              </div>
              <div class="card-body">
                <div id="guild-members-system-content">
                  <div class="text-center">
                    <p>Loading Guild Members Card System...</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Guild 시스템 로드
    if (typeof loadGameSystem === 'function') {
      loadGameSystem();
    }
  }
  
  async loadTradingDashboard() {
    const mainContent = document.getElementById('main-content');
    mainContent.innerHTML = `
      <div class="trading-dashboard-container">
        <div class="row">
          <div class="col-12">
            <div class="card">
              <div class="card-header">
                <h5>📊 Trading Dashboard</h5>
              </div>
              <div class="card-body">
                <div id="trading-dashboard-content">
                  <div class="text-center">
                    <p>Loading Trading Dashboard...</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Trading Dashboard 로드
    if (typeof loadTradingDashboard === 'function') {
      loadTradingDashboard();
    }
  }
  
  async loadVillageSystem() {
    const mainContent = document.getElementById('main-content');
    mainContent.innerHTML = `
      <div class="village-system-container">
        <div class="row">
          <div class="col-12">
            <div class="card">
              <div class="card-header">
                <h5>🏰 Village System</h5>
              </div>
              <div class="card-body">
                <div id="village-system-content">
                  <div class="text-center">
                    <p>Loading Village System...</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Village 시스템 로드
    this.loadVillageContent();
  }
  
  async loadSettings() {
    const mainContent = document.getElementById('main-content');
    mainContent.innerHTML = `
      <div class="settings-container">
        <div class="row">
          <div class="col-12">
            <div class="card">
              <div class="card-header">
                <h5>⚙️ Settings</h5>
              </div>
              <div class="card-body">
                <div class="settings-form">
                  <div class="mb-3">
                    <label class="form-label">Theme</label>
                    <select class="form-select" id="themeSelect">
                      <option value="dark">Dark Theme</option>
                      <option value="light">Light Theme</option>
                    </select>
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Auto Refresh</label>
                    <div class="form-check">
                      <input class="form-check-input" type="checkbox" id="autoRefresh" checked>
                      <label class="form-check-label" for="autoRefresh">
                        Enable auto refresh
                      </label>
                    </div>
                  </div>
                  <button class="btn btn-primary">Save Settings</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  
  updateDashboardData() {
    // 대시보드 데이터 업데이트 로직
    setInterval(() => {
      // 실시간 데이터 업데이트
      if (typeof updateNBGuildInfo === 'function') {
        updateNBGuildInfo();
      }
    }, 5000);
  }
  
  loadVillageContent() {
    // Village 시스템 콘텐츠 로드
    fetch('/game')
      .then(response => response.text())
      .then(html => {
        const villageContent = document.getElementById('village-system-content');
        if (villageContent) {
          villageContent.innerHTML = html;
        }
      })
      .catch(error => {
        console.error('Village content loading error:', error);
      });
  }
  
  syncChartData() {
    // 차트 데이터 동기화
    setTimeout(() => {
      if (typeof window.refreshNbZoneStrip === 'function') {
        window.refreshNbZoneStrip();
      } else if (typeof refreshNbZoneStrip === 'function') {
        refreshNbZoneStrip();
      }
    }, 1000);
  }
}

// 전역 라우터 인스턴스 생성
window.appRouter = new AppRouter();

// 전역 함수로 노출
window.navigateTo = (path) => {
  window.appRouter.navigate(path);
};
