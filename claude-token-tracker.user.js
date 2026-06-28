// ==UserScript==
// @name         Claude Plan Usage
// @namespace    claude-plan-usage
// @version      5.0.0
// @description  claude.ai 화면에 플랜 사용량(세션/주간)을 표시합니다
// @author       Claude Code
// @match        https://claude.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    POLL_INTERVAL: 60000, // 사용량 API 호출 주기
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
    if (now - state.lastUsageFetch < CONFIG.POLL_INTERVAL) return;
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
  //   React가 관리하는 DOM에 끼워넣지 않고,
  //   document.body에 fixed로 독립 배치하여 충돌을 방지한다.
  // ═══════════════════════════════════════════
  function createWidget() {
    const w = document.createElement('div');
    w.id = 'claude-plan-usage';
    w.innerHTML = `
      <style>
        #claude-plan-usage {
          position:fixed; left:12px; bottom:12px; z-index:2147483000;
          width:220px; padding:8px 12px;
          border:1px solid rgba(0,0,0,0.10); border-radius:10px;
          background:rgba(255,255,255,0.95);
          box-shadow:0 2px 10px rgba(0,0,0,0.12);
          backdrop-filter:blur(6px);
          font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          font-size:12px; color:#6b7280; user-select:none;
        }
        @media (prefers-color-scheme: dark) {
          #claude-plan-usage {
            background:rgba(38,38,38,0.95); border-color:rgba(255,255,255,0.10);
            color:#9ca3af;
          }
        }
        #claude-plan-usage * { box-sizing:border-box; }
        #cpu-header {
          display:flex; align-items:center; justify-content:space-between;
          cursor:pointer; padding:2px 0;
        }
        #cpu-title {
          font-weight:600; font-size:11px; text-transform:uppercase;
          letter-spacing:.5px; display:flex; align-items:center; gap:5px;
        }
        #cpu-toggle { font-size:10px; }
        #cpu-body { overflow:hidden; transition:max-height .25s ease,opacity .2s ease; }
        #cpu-body.collapsed { max-height:0!important; opacity:0; margin:0; }
        #cpu-body.expanded { max-height:300px; opacity:1; }
        .cpu-section { margin-bottom:6px; }
        .cpu-section-title { font-size:10px; font-weight:600; margin-bottom:2px; }
        .cpu-bar-label {
          display:flex; justify-content:space-between; align-items:baseline;
          margin-bottom:1px;
        }
        .cpu-pct { font-size:14px; font-weight:700; font-variant-numeric:tabular-nums; }
        .cpu-sub { font-size:9px; opacity:.8; }
        .cpu-bar-bg {
          width:100%; height:4px; border-radius:2px; margin:2px 0;
          overflow:hidden; background:rgba(0,0,0,0.08);
        }
        .cpu-bar {
          height:100%; border-radius:2px; min-width:2px;
          transition:width .5s ease,background-color .3s ease;
        }
        .cpu-div { height:1px; background:rgba(0,0,0,0.08); margin:5px 0; }
        #cpu-updated { font-size:9px; opacity:.7; text-align:right; margin-top:3px; }
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
      applyCollapsed(w);
    });

    applyCollapsed(w);
    return w;
  }

  function applyCollapsed(w) {
    const body = w.querySelector('#cpu-body');
    const tog = w.querySelector('#cpu-toggle');
    if (state.isCollapsed) { body.classList.replace('expanded','collapsed'); tog.textContent='▶'; }
    else { body.classList.replace('collapsed','expanded'); tog.textContent='▼'; }
  }

  function mountWidget() {
    if (document.getElementById('claude-plan-usage')) return;
    document.body.appendChild(createWidget());
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
    setInterval(tick, 5000); // 위젯 유지 + 갱신 시간 표시 (API는 내부에서 60초 스로틀)
    console.log('[PlanUsage] v5.0.0 initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
