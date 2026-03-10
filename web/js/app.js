/**
 * Open Claw Web Report — app.js
 *
 * Fetches agent flow data from `data/flows.json` and heartbeat data from
 * `data/heartbeats.json` (relative to the same CloudFront/S3 origin) and
 * renders the interactive activity-flow and heartbeat dashboards.
 *
 * flows.json schema:
 * {
 *   "lastUpdated": "<ISO-8601>",
 *   "flows": [ { id, name, description, startTime, endTime, status,
 *                agents: [{id, name, type}],
 *                activities: [{id, agentId, action, startTime, endTime,
 *                              status, input, output,
 *                              model (optional, default null),
 *                              tokensIn (optional, default 0),
 *                              tokensOut (optional, default 0)}],
 *                messages: [{from, to, content, timestamp}] } ]
 * }
 *
 * heartbeats.json schema:
 * {
 *   "lastUpdated": "<ISO-8601>",
 *   "agents": [ { id, name, type, lastSeen, status,
 *                 heartbeats: [{timestamp, status, message,
 *                               model (optional, default null),
 *                               tokensIn (optional, default 0),
 *                               tokensOut (optional, default 0)}] } ]
 * }
 */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Configuration                                                        */
  /* ------------------------------------------------------------------ */
  const DATA_URL       = 'data/flows.json';
  const HEARTBEATS_URL = 'data/heartbeats.json';
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
    /* Flows */
    flows: [],
    selectedId: null,
    lastUpdated: null,
    loading: false,
    error: null,
    /* Heartbeats */
    agents: [],
    selectedAgentId: null,
    hbLastUpdated: null,
    hbLoading: false,
    hbError: null,
    /* Active view */
    activeView: 'flows',   /* 'flows' | 'heartbeats' */
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
  /* Data fetching — flows                                               */
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
      if (state.activeView === 'flows') render();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Data fetching — heartbeats                                          */
  /* ------------------------------------------------------------------ */
  async function fetchHeartbeats() {
    state.hbLoading = true;
    state.hbError = null;
    renderHeader();

    try {
      const res = await fetch(HEARTBEATS_URL + '?_=' + Date.now());
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
      const json = await res.json();

      state.agents = (json.agents || []);
      state.hbLastUpdated = json.lastUpdated || null;

      /* Keep the selected agent in sync after refresh */
      if (state.selectedAgentId && !state.agents.find(a => a.id === state.selectedAgentId)) {
        state.selectedAgentId = null;
      }
      if (!state.selectedAgentId && state.agents.length) {
        state.selectedAgentId = state.agents[0].id;
      }
    } catch (err) {
      state.hbError = err.message;
    } finally {
      state.hbLoading = false;
      if (state.activeView === 'heartbeats') render();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Render: top-level                                                    */
  /* ------------------------------------------------------------------ */
  function render() {
    renderHeader();
    if (state.activeView === 'flows') {
      renderSidebar();
      renderMain();
    } else {
      renderHeartbeatSidebar();
      renderHeartbeatMain();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Render: header                                                       */
  /* ------------------------------------------------------------------ */
  function renderHeader() {
    const isFlows = state.activeView === 'flows';
    const loading     = isFlows ? state.loading     : state.hbLoading;
    const count       = isFlows ? state.flows.length : state.agents.length;
    const lastUpdated = isFlows ? state.lastUpdated  : state.hbLastUpdated;

    dom.dataLabel.textContent = isFlows ? 'flows' : 'agents';
    dom.flowCount.textContent = count;
    dom.lastUpdated.textContent = lastUpdated
      ? 'Last updated: ' + formatDateTime(lastUpdated)
      : '';

    if (loading) {
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
  /* Render: main panel (flows)                                          */
  /* ------------------------------------------------------------------ */
  function renderMain() {
    dom.mainFlows.innerHTML = '';

    if (state.loading && !state.flows.length) {
      dom.mainFlows.innerHTML = `
        <div class="loader">
          <div class="loader__ring"></div>
          <span>Loading flows…</span>
        </div>`;
      return;
    }

    if (state.error) {
      dom.mainFlows.innerHTML = `
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
      dom.mainFlows.innerHTML = `
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

    dom.mainFlows.appendChild(buildFlowDetail(flow));
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
    const hasModel = act.model != null;
    const tokensIn  = act.tokensIn  || 0;
    const tokensOut = act.tokensOut || 0;
    const hasTokens = tokensIn > 0 || tokensOut > 0;
    return `
      <div class="timeline-activity timeline-activity--${escHtml(act.status)}">
        <div class="timeline-activity__header">
          <span class="timeline-activity__action">${escHtml(act.action)}</span>
          <span class="badge badge--${escHtml(act.status)}">${statusIcon(act.status)} ${escHtml(act.status)}</span>
          ${durationStr ? `<span style="font-size:11px;color:var(--text-muted)">${escHtml(durationStr)}</span>` : ''}
        </div>
        ${(hasModel || hasTokens) ? `
        <div class="model-info">
          ${hasModel ? `<span class="model-info__model">${escHtml(act.model)}</span>` : ''}
          ${hasTokens ? `<span class="model-info__tokens"><span class="model-info__tokens-in">↓ ${tokensIn.toLocaleString()}</span><span class="model-info__tokens-out">↑ ${tokensOut.toLocaleString()}</span></span>` : ''}
        </div>` : ''}
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
  /* Render: heartbeat sidebar                                            */
  /* ------------------------------------------------------------------ */
  function renderHeartbeatSidebar() {
    dom.hbSidebarCount.textContent = state.agents.length;
    dom.agentList.innerHTML = '';

    if (!state.agents.length && !state.hbLoading) {
      dom.agentList.innerHTML =
        '<li style="padding:16px;color:var(--text-muted);font-size:12px;text-align:center">No agents found.</li>';
      return;
    }

    state.agents.forEach(agent => {
      const li = document.createElement('li');
      li.className = 'agent-item' + (agent.id === state.selectedAgentId ? ' active' : '');
      li.dataset.id = agent.id;

      li.innerHTML = `
        <div class="flow-item__top">
          <span class="flow-item__name">${escHtml(agent.name)}</span>
          <span class="badge badge--${escHtml(agent.status)}">${hbStatusIcon(agent.status)} ${escHtml(agent.status)}</span>
        </div>
        <p class="flow-item__desc">${escHtml(agent.type)}</p>
        <p class="flow-item__time">Last seen: ${formatDateTime(agent.lastSeen)}</p>
      `;

      li.addEventListener('click', () => {
        state.selectedAgentId = agent.id;
        renderHeartbeatSidebar();
        renderHeartbeatMain();
      });

      dom.agentList.appendChild(li);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Render: heartbeat main panel                                         */
  /* ------------------------------------------------------------------ */
  function renderHeartbeatMain() {
    dom.mainHeartbeats.innerHTML = '';

    if (state.hbLoading && !state.agents.length) {
      dom.mainHeartbeats.innerHTML = `
        <div class="loader">
          <div class="loader__ring"></div>
          <span>Loading heartbeats…</span>
        </div>`;
      return;
    }

    if (state.hbError) {
      dom.mainHeartbeats.innerHTML = `
        <div class="error-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>Could not load data: <strong>${escHtml(state.hbError)}</strong></span>
        </div>`;
      return;
    }

    if (!state.agents.length) {
      dom.mainHeartbeats.innerHTML = `
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          <h3>No agents available</h3>
          <p>Upload a <code>data/heartbeats.json</code> file to get started.</p>
        </div>`;
      return;
    }

    const agent = state.agents.find(a => a.id === state.selectedAgentId);
    if (!agent) return;

    dom.mainHeartbeats.appendChild(buildAgentDetail(agent));
  }

  /* ------------------------------------------------------------------ */
  /* Build: agent heartbeat detail                                        */
  /* ------------------------------------------------------------------ */
  function buildAgentDetail(agent) {
    const frag = document.createDocumentFragment();
    const beats = agent.heartbeats || [];
    const activeCount = beats.filter(h => h.status === 'active').length;
    const okCount     = beats.filter(h => h.status === 'ok').length;
    const failedCount = beats.filter(h => h.status === 'failed').length;

    /* ---- Overview card ---- */
    const overview = document.createElement('div');
    overview.className = 'card';
    overview.innerHTML = `
      <div class="card__header">
        <div>
          <h2 class="card__title">${escHtml(agent.name)}</h2>
          <p class="card__desc">${escHtml(agent.type)}</p>
        </div>
        <span class="badge badge--${escHtml(agent.status)}">${hbStatusIcon(agent.status)} ${escHtml(agent.status)}</span>
      </div>
      <div class="card__body">
        <div class="metrics">
          <div class="metric">
            <span class="metric__label">Last Seen</span>
            <span class="metric__value">${formatDateTime(agent.lastSeen)}</span>
          </div>
          <div class="metric">
            <span class="metric__label">Total Beats</span>
            <span class="metric__value">${beats.length}</span>
          </div>
          <div class="metric">
            <span class="metric__label">Active</span>
            <span class="metric__value" style="color:var(--completed)">${activeCount}</span>
          </div>
          <div class="metric">
            <span class="metric__label">OK</span>
            <span class="metric__value" style="color:var(--running)">${okCount}</span>
          </div>
          <div class="metric">
            <span class="metric__label">Failed</span>
            <span class="metric__value" style="color:var(--failed)">${failedCount}</span>
          </div>
          <div class="metric">
            <span class="metric__label">Agent ID</span>
            <span class="metric__value" style="font-family:monospace;font-size:12px">${escHtml(agent.id)}</span>
          </div>
        </div>
      </div>`;
    frag.appendChild(overview);

    /* ---- Heartbeat history card ---- */
    if (beats.length) {
      const historyCard = document.createElement('div');
      historyCard.className = 'card';
      historyCard.innerHTML = `
        <div class="card__header">
          <h3 class="card__title" style="font-size:14px">Heartbeat History</h3>
        </div>
        <div class="card__body">
          <div class="hb-log" id="hb-log-${escHtml(agent.id)}"></div>
        </div>`;
      frag.appendChild(historyCard);

      /* Populate rows newest-first */
      const logContainer = historyCard.querySelector(`#hb-log-${agent.id}`);
      const sorted = [...beats].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      sorted.forEach(beat => {
        const hasModel  = beat.model != null;
        const tokensIn  = beat.tokensIn  || 0;
        const tokensOut = beat.tokensOut || 0;
        const hasTokens = tokensIn > 0 || tokensOut > 0;
        const row = document.createElement('div');
        row.className = `hb-row hb-row--${escHtml(beat.status)}`;
        row.innerHTML = `
          <div class="hb-row__dot" aria-hidden="true"></div>
          <span class="hb-row__time">${formatDateTime(beat.timestamp)}</span>
          <span class="badge badge--${escHtml(beat.status)}">${hbStatusIcon(beat.status)} ${escHtml(beat.status)}</span>
          <span class="hb-row__message">${escHtml(beat.message || '')}</span>
          ${(hasModel || hasTokens) ? `
          <span class="model-info model-info--inline">
            ${hasModel ? `<span class="model-info__model">${escHtml(beat.model)}</span>` : ''}
            ${hasTokens ? `<span class="model-info__tokens"><span class="model-info__tokens-in">↓ ${tokensIn.toLocaleString()}</span><span class="model-info__tokens-out">↑ ${tokensOut.toLocaleString()}</span></span>` : ''}
          </span>` : ''}
        `;
        logContainer.appendChild(row);
      });
    }

    return frag;
  }

  /* ------------------------------------------------------------------ */
  /* Heartbeat status helpers                                             */
  /* ------------------------------------------------------------------ */
  function hbStatusIcon(status) {
    const icons = { active: '●', ok: '○', failed: '✕' };
    const icon = icons[status] || '';
    /* Wrap in aria-hidden so screen readers read only the adjacent text label */
    return icon ? `<span aria-hidden="true">${icon}</span>` : '';
  }

  /* ------------------------------------------------------------------ */
  /* View switching                                                       */
  /* ------------------------------------------------------------------ */
  function switchView(view) {
    state.activeView = view;

    dom.tabFlows.classList.toggle('nav__tab--active', view === 'flows');
    dom.tabHeartbeats.classList.toggle('nav__tab--active', view === 'heartbeats');
    dom.tabFlows.setAttribute('aria-selected', view === 'flows');
    dom.tabHeartbeats.setAttribute('aria-selected', view === 'heartbeats');

    if (view === 'flows') {
      dom.sidebarFlows.removeAttribute('hidden');
      dom.mainFlows.removeAttribute('hidden');
      dom.sidebarHeartbeats.setAttribute('hidden', '');
      dom.mainHeartbeats.setAttribute('hidden', '');
    } else {
      dom.sidebarHeartbeats.removeAttribute('hidden');
      dom.mainHeartbeats.removeAttribute('hidden');
      dom.sidebarFlows.setAttribute('hidden', '');
      dom.mainFlows.setAttribute('hidden', '');
    }

    render();
  }

  /* ------------------------------------------------------------------ */
  /* Bootstrap                                                            */
  /* ------------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', () => {
    dom = {
      refreshBtn:       document.getElementById('refresh-btn'),
      lastUpdated:      document.getElementById('last-updated'),
      flowCount:        document.getElementById('flow-count'),
      dataLabel:        document.getElementById('data-label'),
      /* Flows */
      sidebarFlows:     document.getElementById('sidebar-flows'),
      sidebarCount:     document.getElementById('sidebar-count'),
      sidebarList:      document.getElementById('flow-list'),
      mainFlows:        document.getElementById('main-flows'),
      /* Heartbeats */
      sidebarHeartbeats: document.getElementById('sidebar-heartbeats'),
      hbSidebarCount:   document.getElementById('hb-sidebar-count'),
      agentList:        document.getElementById('agent-list'),
      mainHeartbeats:   document.getElementById('main-heartbeats'),
      /* Navigation */
      tabFlows:         document.getElementById('tab-flows'),
      tabHeartbeats:    document.getElementById('tab-heartbeats'),
    };

    dom.refreshBtn.addEventListener('click', () => {
      if (state.activeView === 'flows') fetchFlows();
      else fetchHeartbeats();
    });

    dom.tabFlows.addEventListener('click', () => switchView('flows'));
    dom.tabHeartbeats.addEventListener('click', () => switchView('heartbeats'));

    /* Initial fetch for both views */
    fetchFlows();
    fetchHeartbeats();

    /* Auto-refresh both every 30 s */
    setInterval(fetchFlows, AUTO_REFRESH_MS);
    setInterval(fetchHeartbeats, AUTO_REFRESH_MS);
  });

})();
