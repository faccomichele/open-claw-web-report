/**
 * Open Claw Web Report — app.js
 *
 * Fetches agent flow data from `data/flows.json` (relative to the same
 * CloudFront/S3 origin) and renders the interactive activity-flow dashboard.
 *
 * JSON schema expected:
 * {
 *   "lastUpdated": "<ISO-8601>",
 *   "flows": [ { id, name, description, startTime, endTime, status,
 *                agents: [{id, name, type}],
 *                activities: [{id, agentId, action, startTime, endTime,
 *                              status, input, output}],
 *                messages: [{from, to, content, timestamp}] } ]
 * }
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Configuration                                                        */
  /* ------------------------------------------------------------------ */
  const DATA_URL = 'data/flows.json';
  const AUTO_REFRESH_MS = 30_000; // 30 s

  /* Agent-type colours (deterministic from agent index as fallback) */
  const PALETTE = [
    '#6b46c1', '#2b6cb0', '#276749', '#c05621',
    '#97266d', '#2c7a7b', '#744210', '#2d3748',
  ];

  /* ------------------------------------------------------------------ */
  /* State                                                                */
  /* ------------------------------------------------------------------ */
  let state = {
    flows: [],
    selectedId: null,
    lastUpdated: null,
    loading: false,
    error: null,
  };

  /* ------------------------------------------------------------------ */
  /* DOM references (resolved after DOMContentLoaded)                    */
  /* ------------------------------------------------------------------ */
  let dom = {};

  /* ------------------------------------------------------------------ */
  /* Utility helpers                                                      */
  /* ------------------------------------------------------------------ */
  function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  function formatTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  function calcDuration(start, end) {
    if (!start || !end) return null;
    const ms = new Date(end) - new Date(start);
    if (ms < 0) return null;
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const rem  = secs % 60;
    return rem ? `${mins}m ${rem}s` : `${mins}m`;
  }

  function agentColor(agent, index) {
    return PALETTE[index % PALETTE.length];
  }

  function agentColorMap(agents) {
    const map = {};
    (agents || []).forEach((a, i) => { map[a.id] = agentColor(a, i); });
    return map;
  }

  function escHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ------------------------------------------------------------------ */
  /* Data fetching                                                        */
  /* ------------------------------------------------------------------ */
  async function fetchFlows() {
    state.loading = true;
    state.error = null;
    renderHeader();

    try {
      const res = await fetch(DATA_URL + '?_=' + Date.now());
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
      const json = await res.json();

      state.flows = (json.flows || []).sort(
        (a, b) => new Date(b.startTime) - new Date(a.startTime)
      );
      state.lastUpdated = json.lastUpdated || null;

      /* Keep the selected flow in sync after refresh */
      if (state.selectedId && !state.flows.find(f => f.id === state.selectedId)) {
        state.selectedId = null;
      }
      if (!state.selectedId && state.flows.length) {
        state.selectedId = state.flows[0].id;
      }
    } catch (err) {
      state.error = err.message;
    } finally {
      state.loading = false;
      render();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Render: top-level                                                    */
  /* ------------------------------------------------------------------ */
  function render() {
    renderHeader();
    renderSidebar();
    renderMain();
  }

  /* ------------------------------------------------------------------ */
  /* Render: header                                                       */
  /* ------------------------------------------------------------------ */
  function renderHeader() {
    dom.lastUpdated.textContent = state.lastUpdated
      ? 'Last updated: ' + formatDateTime(state.lastUpdated)
      : '';
    dom.flowCount.textContent = state.flows.length;

    if (state.loading) {
      dom.refreshBtn.classList.add('spinning');
    } else {
      dom.refreshBtn.classList.remove('spinning');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Render: sidebar flow list                                            */
  /* ------------------------------------------------------------------ */
  function renderSidebar() {
    dom.sidebarCount.textContent = state.flows.length;
    dom.sidebarList.innerHTML = '';

    if (!state.flows.length && !state.loading) {
      dom.sidebarList.innerHTML =
        '<li style="padding:16px;color:var(--text-muted);font-size:12px;text-align:center">No flows found.</li>';
      return;
    }

    state.flows.forEach(flow => {
      const li = document.createElement('li');
      li.className = 'flow-item' + (flow.id === state.selectedId ? ' active' : '');
      li.dataset.id = flow.id;

      const duration = calcDuration(flow.startTime, flow.endTime);

      li.innerHTML = `
        <div class="flow-item__top">
          <span class="flow-item__name">${escHtml(flow.name)}</span>
          <span class="badge badge--${escHtml(flow.status)}">${statusIcon(flow.status)} ${escHtml(flow.status)}</span>
        </div>
        <p class="flow-item__desc">${escHtml(flow.description)}</p>
        <p class="flow-item__time">${formatDateTime(flow.startTime)}${duration ? ' · ' + duration : ''}</p>
      `;

      li.addEventListener('click', () => {
        state.selectedId = flow.id;
        render();
      });

      dom.sidebarList.appendChild(li);
    });
  }

  function statusIcon(status) {
    const icons = {
      completed: '✓',
      running:   '◉',
      failed:    '✕',
    };
    return icons[status] || '';
  }

  /* ------------------------------------------------------------------ */
  /* Render: main panel                                                   */
  /* ------------------------------------------------------------------ */
  function renderMain() {
    dom.mainPanel.innerHTML = '';

    if (state.loading && !state.flows.length) {
      dom.mainPanel.innerHTML = `
        <div class="loader">
          <div class="loader__ring"></div>
          <span>Loading flows…</span>
        </div>`;
      return;
    }

    if (state.error) {
      dom.mainPanel.innerHTML = `
        <div class="error-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>Could not load data: <strong>${escHtml(state.error)}</strong></span>
        </div>`;
      return;
    }

    if (!state.flows.length) {
      dom.mainPanel.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="2"/>
            <path d="M12 8v4M12 16h.01"/>
          </svg>
          <h3>No flows available</h3>
          <p>Upload a <code>data/flows.json</code> file to get started.</p>
        </div>`;
      return;
    }

    const flow = state.flows.find(f => f.id === state.selectedId);
    if (!flow) return;

    dom.mainPanel.appendChild(buildFlowDetail(flow));
  }

  /* ------------------------------------------------------------------ */
  /* Build: flow detail                                                   */
  /* ------------------------------------------------------------------ */
  function buildFlowDetail(flow) {
    const colors = agentColorMap(flow.agents);
    const frag = document.createDocumentFragment();

    /* ---- Overview card ---- */
    const overview = document.createElement('div');
    overview.className = 'card';
    const duration = calcDuration(flow.startTime, flow.endTime);
    overview.innerHTML = `
      <div class="card__header">
        <div>
          <h2 class="card__title">${escHtml(flow.name)}</h2>
          <p class="card__desc">${escHtml(flow.description)}</p>
        </div>
        <span class="badge badge--${escHtml(flow.status)}">${statusIcon(flow.status)} ${escHtml(flow.status)}</span>
      </div>
      <div class="card__body">
        <div class="metrics">
          <div class="metric">
            <span class="metric__label">Started</span>
            <span class="metric__value">${formatDateTime(flow.startTime)}</span>
          </div>
          <div class="metric">
            <span class="metric__label">Finished</span>
            <span class="metric__value">${flow.endTime ? formatDateTime(flow.endTime) : '—'}</span>
          </div>
          ${duration ? `
          <div class="metric">
            <span class="metric__label">Duration</span>
            <span class="metric__value">${escHtml(duration)}</span>
          </div>` : ''}
          <div class="metric">
            <span class="metric__label">Activities</span>
            <span class="metric__value">${flow.activities ? flow.activities.length : 0}</span>
          </div>
          <div class="metric">
            <span class="metric__label">Agents</span>
            <span class="metric__value">${flow.agents ? flow.agents.length : 0}</span>
          </div>
          <div class="metric">
            <span class="metric__label">Flow ID</span>
            <span class="metric__value" style="font-family:monospace;font-size:12px">${escHtml(flow.id)}</span>
          </div>
        </div>
      </div>`;
    frag.appendChild(overview);

    /* ---- Agents card ---- */
    if (flow.agents && flow.agents.length) {
      const agentsCard = document.createElement('div');
      agentsCard.className = 'card';
      agentsCard.innerHTML = `
        <div class="card__header">
          <h3 class="card__title" style="font-size:14px">Participating Agents</h3>
        </div>
        <div class="card__body">
          <div class="agents-grid">
            ${flow.agents.map(a => `
              <div class="agent-chip">
                <div class="agent-chip__dot" style="background:${escHtml(colors[a.id] || '#718096')}"></div>
                <span class="agent-chip__name">${escHtml(a.name)}</span>
                <span class="agent-chip__type">${escHtml(a.type)}</span>
              </div>`).join('')}
          </div>
        </div>`;
      frag.appendChild(agentsCard);
    }

    /* ---- Activity timeline card ---- */
    if (flow.activities && flow.activities.length) {
      const timelineCard = document.createElement('div');
      timelineCard.className = 'card';
      timelineCard.innerHTML = `
        <div class="card__header">
          <h3 class="card__title" style="font-size:14px">Activity Timeline</h3>
        </div>
        <div class="card__body">
          <div class="timeline" id="timeline-${escHtml(flow.id)}"></div>
        </div>`;
      frag.appendChild(timelineCard);

      /* Populate timeline after insertion */
      const placeholder = timelineCard.querySelector(`#timeline-${flow.id}`);
      flow.activities.forEach((act, idx) => {
        const agent = (flow.agents || []).find(a => a.id === act.agentId);
        const agentName = agent ? agent.name : act.agentId;
        const color = colors[act.agentId] || '#718096';
        const isLast = idx === flow.activities.length - 1;

        const item = document.createElement('div');
        item.className = 'timeline-item';
        item.innerHTML = `
          ${!isLast ? '<div class="timeline-item__line"></div>' : ''}
          <div class="timeline-item__agent-col">
            <div class="timeline-item__agent-name" title="${escHtml(agentName)}"
                 style="color:${escHtml(color)}">${escHtml(agentName)}</div>
            <div class="timeline-item__time">${formatTime(act.startTime)}</div>
          </div>
          <div class="timeline-item__dot-col">
            <div class="timeline-item__dot timeline-item__dot--${escHtml(act.status)}"
                 style="background:${escHtml(color)};outline-color:${escHtml(color)}"></div>
          </div>
          <div class="timeline-item__content">
            ${buildActivityCard(act)}
          </div>`;
        placeholder.appendChild(item);
      });
    }

    /* ---- Message log card ---- */
    if (flow.messages && flow.messages.length) {
      const msgCard = document.createElement('div');
      msgCard.className = 'card';
      msgCard.innerHTML = `
        <div class="card__header">
          <h3 class="card__title" style="font-size:14px">Agent Communication Log</h3>
        </div>
        <div class="card__body">
          <div class="message-log">
            ${flow.messages.map(m => {
              const fromColor = colors[m.from] || '#718096';
              const toColor   = colors[m.to]   || '#718096';
              return `
                <div class="message-row">
                  <span class="message-row__time">${formatTime(m.timestamp)}</span>
                  <span class="message-row__arrow">
                    <span class="message-row__from" style="color:${escHtml(fromColor)}">${escHtml(m.from)}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                    </svg>
                    <span class="message-row__to" style="color:${escHtml(toColor)}">${escHtml(m.to)}</span>
                  </span>
                  <span class="message-row__content">${escHtml(m.content)}</span>
                </div>`;
            }).join('')}
          </div>
        </div>`;
      frag.appendChild(msgCard);
    }

    return frag;
  }

  /* ------------------------------------------------------------------ */
  /* Build: single activity card HTML                                     */
  /* ------------------------------------------------------------------ */
  function buildActivityCard(act) {
    const durationStr = calcDuration(act.startTime, act.endTime);
    return `
      <div class="timeline-activity timeline-activity--${escHtml(act.status)}">
        <div class="timeline-activity__header">
          <span class="timeline-activity__action">${escHtml(act.action)}</span>
          <span class="badge badge--${escHtml(act.status)}">${statusIcon(act.status)} ${escHtml(act.status)}</span>
          ${durationStr ? `<span style="font-size:11px;color:var(--text-muted)">${escHtml(durationStr)}</span>` : ''}
        </div>
        ${(act.input != null || act.output != null) ? `
        <div class="io-grid">
          ${act.input != null ? `
          <div class="io-block">
            <div class="io-block__label">Input</div>
            <div class="io-block__value">${escHtml(act.input)}</div>
          </div>` : ''}
          ${act.output != null ? `
          <div class="io-block">
            <div class="io-block__label">Output</div>
            <div class="io-block__value">${escHtml(act.output)}</div>
          </div>` : ''}
        </div>` : ''}
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Bootstrap                                                            */
  /* ------------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', () => {
    dom = {
      refreshBtn:   document.getElementById('refresh-btn'),
      lastUpdated:  document.getElementById('last-updated'),
      flowCount:    document.getElementById('flow-count'),
      sidebarCount: document.getElementById('sidebar-count'),
      sidebarList:  document.getElementById('flow-list'),
      mainPanel:    document.getElementById('main-panel'),
    };

    dom.refreshBtn.addEventListener('click', fetchFlows);

    fetchFlows();
    setInterval(fetchFlows, AUTO_REFRESH_MS);
  });

})();
