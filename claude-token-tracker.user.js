// ==UserScript==
// @name         Claude Plan Usage
// @namespace    claude-plan-usage
// @version      4.1.0
// @description  claude.ai 사이드바에 플랜 사용량(세션/주간)을 표시합니다
// @author       Claude Code
// @match        https://claude.ai/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    POLL_INTERVAL: 4000,
    USAGE_API_INTERVAL: 60000,
  };

  // ═══════════════════════════════════════════
  // 상태
  // ═══════════════════════════════════════════
  const state = {
    planUsage: null,
    lastUsageFetch: 0,
    orgId: null,
    isCollapsed: false,
  };

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('claude-plan-usage-prefs') || '{}');
      if (p.isCollapsed !== undefined) state.isCollapsed = p.isCollapsed;
    } catch (e) {}
  }

  function savePrefs() {
    try {
      localStorage.setItem('claude-plan-usage-prefs', JSON.stringify({
        isCollapsed: state.isCollapsed,
      }));
    } catch (e) {}
  }

  // ═══════════════════════════════════════════
  // 플랜 사용량 API
  // ═══════════════════════════════════════════
  function getOrgId() {
    if (state.orgId) return state.orgId;
    const match = document.cookie.match(/lastActiveOrg=([a-f0-9-]{36})/);
    if (match) state.orgId = match[1];
    return state.orgId;
  }

  async function fetchPlanUsage() {
    const now = Date.now();
    if (now - state.lastUsageFetch < CONFIG.USAGE_API_INTERVAL) return;
    state.lastUsageFetch = now;

    const orgId = getOrgId();
    if (!orgId) return;

    try {
      const resp = await fetch(`/api/organizations/${orgId}/usage`);
      if (!resp.ok) return;
      state.planUsage = await resp.json();
      updateUI();
    } catch (e) {}
  }

  // 메시지 전송 후 플랜 사용량 즉시 갱신
  // 주의: 응답 본문(스트림)은 절대 읽거나 clone()하지 않는다.
  // 스트리밍 응답을 clone().text()로 읽으면 브라우저가 스트림을 이중 버퍼링하여
  // 메모리가 누적되고 다음 접속 시 무한 로딩이 발생할 수 있다.
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const [input, init] = args;
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/completion') && init?.method === 'POST' && response.ok) {
        // 본문은 건드리지 않고, 잠시 후 사용량 API만 다시 호출
        setTimeout(() => {
          state.lastUsageFetch = 0;
          fetchPlanUsage();
        }, 4000);
      }
    } catch (e) {}
    return response;
  };

  function formatResetTime(isoStr) {
    if (!isoStr) return '';
    const diffMs = new Date(isoStr) - new Date();
    if (diffMs <= 0) return '곧 리셋';
    const hours = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    if (hours >= 24) return `${Math.floor(hours / 24)}일 ${hours % 24}시간 후`;
    if (hours > 0) return `${hours}시간 ${mins}분 후`;
    return `${mins}분 후`;
  }

  function formatResetDate(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const wd = ['일','월','화','수','목','금','토'][d.getDay()];
    const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
    return `(${wd}) ${h >= 12 ? '오후' : '오전'} ${h % 12 || 12}:${m}`;
  }

  function barColor(p) {
    if (p >= 90) return '#ef4444';
    if (p >= 70) return '#f59e0b';
    return '#10b981';
  }

  // ═══════════════════════════════════════════
  // UI
  // ═══════════════════════════════════════════
  function createWidget() {
    const w = document.createElement('div');
    w.id = 'claude-plan-usage';
    w.innerHTML = `
      <style>
        #claude-plan-usage {
          width:100%; padding:8px 12px;
          border-top:1px solid var(--border-300,rgba(0,0,0,0.08));
          font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          font-size:12px; color:var(--text-500,#6b7280);
          background:transparent; user-select:none;
        }
        #claude-plan-usage * { box-sizing:border-box; }
        #cpu-header {
          display:flex; align-items:center; justify-content:space-between;
          cursor:pointer; padding:2px 0;
        }
        #cpu-header:hover { color:var(--text-300,#374151); }
        #cpu-title {
          font-weight:600; font-size:11px; text-transform:uppercase;
          letter-spacing:.5px; display:flex; align-items:center; gap:5px;
        }
        #cpu-toggle { font-size:10px; }
        #cpu-body { overflow:hidden; transition:max-height .25s ease,opacity .2s ease; }
        #cpu-body.collapsed { max-height:0!important; opacity:0; }
        #cpu-body.expanded { max-height:300px; opacity:1; }
        .cpu-section { margin-bottom:6px; }
        .cpu-section-title {
          font-size:10px; font-weight:600; color:var(--text-400,#6b7280);
          margin-bottom:2px;
        }
        .cpu-bar-label {
          display:flex; justify-content:space-between; align-items:baseline;
          margin-bottom:1px;
        }
        .cpu-pct {
          font-size:14px; font-weight:700; font-variant-numeric:tabular-nums;
        }
        .cpu-sub { font-size:9px; color:var(--text-500,#9ca3af); }
        .cpu-bar-bg {
          width:100%; height:4px; border-radius:2px; margin:2px 0;
          overflow:hidden; background:var(--bg-300,rgba(0,0,0,0.06));
        }
        .cpu-bar {
          height:100%; border-radius:2px; min-width:2px;
          transition:width .5s ease,background-color .3s ease;
        }
        .cpu-div { height:1px; background:var(--border-300,rgba(0,0,0,0.06)); margin:5px 0; }
        #cpu-updated { font-size:9px; color:var(--text-500,#9ca3af); text-align:right; margin-top:3px; }
      </style>

      <div id="cpu-header">
        <span id="cpu-title">
          <span>📊</span>
          <span>플랜 사용량</span>
        </span>
        <span id="cpu-toggle">▼</span>
      </div>

      <div id="cpu-body" class="expanded">
        <div class="cpu-section">
          <div class="cpu-section-title">현재 세션</div>
          <div class="cpu-bar-label">
            <span id="cpu-session-pct" class="cpu-pct" style="color:#10b981">--%</span>
            <span id="cpu-session-reset" class="cpu-sub">--</span>
          </div>
          <div class="cpu-bar-bg"><div class="cpu-bar" id="cpu-session-bar" style="width:0%;background:#10b981"></div></div>
        </div>
        <div class="cpu-div"></div>
        <div class="cpu-section">
          <div class="cpu-section-title">주간 한도</div>
          <div class="cpu-bar-label">
            <span id="cpu-weekly-pct" class="cpu-pct" style="color:#10b981">--%</span>
            <span id="cpu-weekly-reset" class="cpu-sub">--</span>
          </div>
          <div class="cpu-bar-bg"><div class="cpu-bar" id="cpu-weekly-bar" style="width:0%;background:#10b981"></div></div>
        </div>
        <div id="cpu-updated"></div>
      </div>
    `;

    w.querySelector('#cpu-header').addEventListener('click', () => {
      state.isCollapsed = !state.isCollapsed; savePrefs();
      const body = w.querySelector('#cpu-body');
      const tog = w.querySelector('#cpu-toggle');
      if (state.isCollapsed) { body.classList.replace('expanded','collapsed'); tog.textContent='▶'; }
      else { body.classList.replace('collapsed','expanded'); tog.textContent='▼'; }
    });

    if (state.isCollapsed) {
      w.querySelector('#cpu-body').classList.replace('expanded','collapsed');
      w.querySelector('#cpu-toggle').textContent = '▶';
    }

    return w;
  }

  function mountWidget() {
    if (document.getElementById('claude-plan-usage')) return;
    const btn = document.querySelector('[data-testid="user-menu-button"]');
    if (!btn) return;
    const border = btn.parentElement?.parentElement;
    const sidebar = border?.parentElement;
    if (!sidebar) return;
    sidebar.insertBefore(createWidget(), border);
  }

  function updateUI() {
    const w = document.getElementById('claude-plan-usage');
    if (!w) return;
    const el = (id) => w.querySelector('#' + id);
    const plan = state.planUsage;
    if (!plan) return;

    const sp = plan.five_hour?.utilization ?? 0;
    const sc = barColor(sp);
    if (el('cpu-session-pct')) { el('cpu-session-pct').textContent = sp + '%'; el('cpu-session-pct').style.color = sc; }
    if (el('cpu-session-bar')) { el('cpu-session-bar').style.width = sp + '%'; el('cpu-session-bar').style.backgroundColor = sc; }
    if (el('cpu-session-reset')) el('cpu-session-reset').textContent = formatResetTime(plan.five_hour?.resets_at);

    const wp = plan.seven_day?.utilization ?? 0;
    const wc = barColor(wp);
    if (el('cpu-weekly-pct')) { el('cpu-weekly-pct').textContent = wp + '%'; el('cpu-weekly-pct').style.color = wc; }
    if (el('cpu-weekly-bar')) { el('cpu-weekly-bar').style.width = wp + '%'; el('cpu-weekly-bar').style.backgroundColor = wc; }
    if (el('cpu-weekly-reset')) el('cpu-weekly-reset').textContent = formatResetDate(plan.seven_day?.resets_at) + ' 리셋';

    if (el('cpu-updated')) {
      const ago = Math.round((Date.now() - state.lastUsageFetch) / 1000);
      el('cpu-updated').textContent = ago < 10 ? '방금 업데이트' : `${Math.floor(ago / 60)}분 전 업데이트`;
    }
  }

  // ═══════════════════════════════════════════
  // 메인 루프
  // ═══════════════════════════════════════════
  function tick() {
    try {
      mountWidget();
      fetchPlanUsage();
      updateUI();
    } catch (e) { console.error('[PlanUsage]', e); }
  }

  function init() {
    loadPrefs();
    tick();
    setInterval(tick, CONFIG.POLL_INTERVAL);
    console.log('[PlanUsage] v4.1.0 initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000));
  } else {
    setTimeout(init, 2000);
  }
})();
