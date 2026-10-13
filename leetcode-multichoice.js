// ==UserScript==
// @name         力扣题单批量管理器
// @namespace    https://leetcode.cn/
// @version      1.0.2
// @description  为 leetcode.cn 题单增加多选、批量移除、批量添加至题单和批量置顶。
// @author       Codex
// @match        https://leetcode.cn/problem-list/*
// @icon         https://leetcode.cn/favicon.ico
// @grant        none
// @run-at       document-idle
// @license MIT
// @downloadURL https://update.greasyfork.org/scripts/586875/%E5%8A%9B%E6%89%A3%E9%A2%98%E5%8D%95%E6%89%B9%E9%87%8F%E7%AE%A1%E7%90%86%E5%99%A8.user.js
// @updateURL https://update.greasyfork.org/scripts/586875/%E5%8A%9B%E6%89%A3%E9%A2%98%E5%8D%95%E6%89%B9%E9%87%8F%E7%AE%A1%E7%90%86%E5%99%A8.meta.js
// ==/UserScript==

(() => {
  'use strict';

  const APP_ID = 'lclm-app';
  // 题单 V2 相关查询和 mutation 均由力扣的主 GraphQL 客户端发送。
  // `/graphql/noj-go/` 是另一套 schema，不包含 myFavoriteList 等字段。
  const GRAPHQL_ENDPOINT = '/graphql/';
  const selected = new Map();
  let currentPath = location.pathname;
  let isBusy = false;
  let scanQueued = false;

  const operations = {
    myFavoriteList: `
      query myFavoriteList {
        myCreatedFavoriteList {
          favorites { name slug favoriteType }
        }
      }
    `,
    addQuestionToFavoriteV2: `
      mutation addQuestionToFavoriteV2($favoriteSlug: String!, $questionSlug: String!) {
        addQuestionToFavoriteV2(favoriteSlug: $favoriteSlug, questionSlug: $questionSlug) {
          ok
          error
        }
      }
    `,
    removeQuestionFromFavoriteV2: `
      mutation removeQuestionFromFavoriteV2($favoriteSlug: String!, $questionSlug: String!) {
        removeQuestionFromFavoriteV2(favoriteSlug: $favoriteSlug, questionSlug: $questionSlug) {
          ok
          error
        }
      }
    `,
    reorderFavoriteQuestionV2: `
      mutation reorderFavoriteQuestionV2($favoriteSlug: String!, $questionSlug: String!, $moveToTop: Boolean) {
        reorderFavoriteQuestionV2(
          favoriteSlug: $favoriteSlug
          questionSlug: $questionSlug
          moveToTop: $moveToTop
        ) {
          ok
          error
        }
      }
    `,
  };

  function getCookie(name) {
    const prefix = `${name}=`;
    const pair = document.cookie.split('; ').find((item) => item.startsWith(prefix));
    return pair ? decodeURIComponent(pair.slice(prefix.length)) : '';
  }

  function getRandomUuid() {
    let value = localStorage.getItem('random-uuid');
    if (value) return value;
    value = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
        const random = Math.random() * 16 | 0;
        return (character === 'x' ? random : (random & 0x3 | 0x8)).toString(16);
      });
    localStorage.setItem('random-uuid', value);
    return value;
  }

  async function graphql(operationName, variables = {}) {
    const query = operations[operationName];
    if (!query) throw new Error(`未知操作：${operationName}`);

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-operation-name': operationName,
      'random-uuid': getRandomUuid(),
    };
    const csrfToken = getCookie('csrftoken');
    if (csrfToken) headers['X-CSRFToken'] = csrfToken;
    const appToken = getCookie('__appToken__');
    if (appToken) headers.Authorization = `Bearer ${appToken}`;

    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({ operationName, query, variables }),
    });

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`接口返回了无法解析的内容（HTTP ${response.status}）`);
    }
    const apiMessage = payload.errors?.[0]?.message || payload.error || payload.message;
    if (!response.ok) throw new Error(apiMessage || `请求失败（HTTP ${response.status}）`);
    if (payload.errors?.length) throw new Error(apiMessage || '力扣接口返回错误');
    return payload.data;
  }

  function getCurrentListSlug() {
    const match = location.pathname.match(/^\/problem-list\/([^/]+)\/?/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function problemFromLink(link) {
    try {
      const url = new URL(link.href, location.origin);
      const match = url.pathname.match(/^\/problems\/([^/]+)\/?$/);
      if (!match || url.searchParams.get('envType') !== 'problem-list-v2') return null;
      const titleNode = link.querySelector('div, span');
      const title = (titleNode?.textContent || link.textContent || match[1]).trim();
      return { slug: decodeURIComponent(match[1]), title };
    } catch {
      return null;
    }
  }

  function updateToolbar() {
    const count = document.querySelector(`#${APP_ID} [data-role="count"]`);
    if (count) count.textContent = `${selected.size} 题`;
    document.querySelectorAll(`#${APP_ID} button[data-needs-selection]`).forEach((button) => {
      button.disabled = isBusy || selected.size === 0;
    });
    const clear = document.querySelector(`#${APP_ID} button[data-action="clear"]`);
    if (clear) clear.disabled = isBusy || selected.size === 0;
  }

  function setBusy(value, message = '') {
    isBusy = value;
    document.querySelectorAll(`#${APP_ID} button`).forEach((button) => {
      button.disabled = value || (button.hasAttribute('data-needs-selection') && selected.size === 0);
    });
    const status = document.querySelector(`#${APP_ID} [data-role="status"]`);
    if (status) status.textContent = message;
    updateToolbar();
  }

  function syncRenderedRows() {
    document.querySelectorAll('.lclm-checkbox input').forEach((input) => {
      input.checked = selected.has(input.dataset.slug);
      input.closest('.lclm-row')?.classList.toggle('lclm-selected', input.checked);
    });
    updateToolbar();
  }

  function clearSelection() {
    selected.clear();
    syncRenderedRows();
  }

  function decorateRows() {
    scanQueued = false;
    if (location.pathname !== currentPath) {
      currentPath = location.pathname;
      clearSelection();
    }

    const links = document.querySelectorAll('a[href*="/problems/"][href*="envType=problem-list-v2"]');
    links.forEach((link) => {
      const problem = problemFromLink(link);
      if (!problem) return;
      const row = link.parentElement;
      if (!row) return;

      let holder = row.querySelector(':scope > .lclm-checkbox');
      if (!holder) {
        holder = document.createElement('label');
        holder.className = 'lclm-checkbox';
        holder.title = '选择此题';
        holder.innerHTML = '<input type="checkbox"><span aria-hidden="true"></span>';
        holder.addEventListener('click', (event) => event.stopPropagation());
        holder.querySelector('input').addEventListener('change', (event) => {
          const input = event.currentTarget;
          if (input.checked) selected.set(input.dataset.slug, input.dataset.title);
          else selected.delete(input.dataset.slug);
          row.classList.toggle('lclm-selected', input.checked);
          updateToolbar();
        });
        row.prepend(holder);
        row.classList.add('lclm-row');
      }

      const input = holder.querySelector('input');
      input.dataset.slug = problem.slug;
      input.dataset.title = problem.title;
      input.setAttribute('aria-label', `选择 ${problem.title}`);
      input.checked = selected.has(problem.slug);
      row.classList.toggle('lclm-selected', input.checked);
    });
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(decorateRows);
  }

  function toast(message, type = 'success') {
    const item = document.createElement('div');
    item.className = `lclm-toast lclm-toast-${type}`;
    item.textContent = message;
    document.querySelector(`#${APP_ID} [data-role="toasts"]`)?.append(item);
    setTimeout(() => item.remove(), 3600);
  }

  function selectedProblems() {
    return [...selected].map(([slug, title]) => ({ slug, title }));
  }

  async function runSequential(items, worker) {
    const failures = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      setBusy(true, `${index + 1}/${items.length}`);
      try {
        await worker(item);
      } catch (error) {
        failures.push({ item, error });
      }
    }
    return failures;
  }

  function ensureMutationOk(result, field) {
    const value = result?.[field];
    if (!value?.ok) throw new Error(value?.error || `${field} 操作失败`);
  }

  async function removeSelected() {
    const favoriteSlug = getCurrentListSlug();
    const items = selectedProblems();
    if (!favoriteSlug) return toast('请先打开一个具体题单', 'error');
    if (!confirm(`确定从当前题单移除选中的 ${items.length} 道题吗？\n\n此操作会直接修改力扣账号中的题单。`)) return;

    setBusy(true, '正在移除…');
    const failures = await runSequential(items, async ({ slug }) => {
      const result = await graphql('removeQuestionFromFavoriteV2', {
        favoriteSlug,
        questionSlug: slug,
      });
      ensureMutationOk(result, 'removeQuestionFromFavoriteV2');
    });
    setBusy(false);
    if (failures.length) {
      toast(`已移除 ${items.length - failures.length} 题，${failures.length} 题失败`, 'error');
      failures.forEach(({ item }) => selected.delete(item.slug));
      syncRenderedRows();
      return;
    }
    toast(`已移除 ${items.length} 道题`);
    setTimeout(() => location.reload(), 500);
  }

  async function pinSelected() {
    const favoriteSlug = getCurrentListSlug();
    const items = selectedProblems();
    if (!favoriteSlug) return toast('请先打开一个具体题单', 'error');
    if (!confirm(`将选中的 ${items.length} 道题置顶吗？\n\n题目会按选择顺序排列在题单顶部。`)) return;

    setBusy(true, '正在置顶…');
    const failures = await runSequential([...items].reverse(), async ({ slug }) => {
      const result = await graphql('reorderFavoriteQuestionV2', {
        favoriteSlug,
        questionSlug: slug,
        moveToTop: true,
      });
      ensureMutationOk(result, 'reorderFavoriteQuestionV2');
    });
    setBusy(false);
    if (failures.length) return toast(`已置顶 ${items.length - failures.length} 题，${failures.length} 题失败`, 'error');
    toast(`已置顶 ${items.length} 道题`);
    setTimeout(() => location.reload(), 500);
  }

  async function openAddDialog() {
    const dialog = document.querySelector(`#${APP_ID} dialog`);
    const list = dialog.querySelector('[data-role="favorite-list"]');
    list.innerHTML = '<div class="lclm-loading">正在读取你的题单…</div>';
    dialog.showModal();
    try {
      const data = await graphql('myFavoriteList');
      const favorites = data?.myCreatedFavoriteList?.favorites || [];
      if (!favorites.length) {
        list.innerHTML = '<div class="lclm-empty">还没有可添加的自建题单</div>';
        return;
      }
      list.replaceChildren(...favorites.map((favorite) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lclm-favorite';
        button.dataset.slug = favorite.slug;
        button.innerHTML = `<span>${escapeHtml(favorite.name)}</span><small>${escapeHtml(favorite.slug)}</small>`;
        button.addEventListener('click', () => addSelectedTo(favorite));
        return button;
      }));
    } catch (error) {
      list.innerHTML = `<div class="lclm-empty">${escapeHtml(error.message)}</div>`;
    }
  }

  async function addSelectedTo(favorite) {
    const items = selectedProblems();
    const dialog = document.querySelector(`#${APP_ID} dialog`);
    dialog.close();
    setBusy(true, '正在添加…');
    const failures = await runSequential(items, async ({ slug }) => {
      const result = await graphql('addQuestionToFavoriteV2', {
        favoriteSlug: favorite.slug,
        questionSlug: slug,
      });
      ensureMutationOk(result, 'addQuestionToFavoriteV2');
    });
    setBusy(false);
    if (failures.length) {
      toast(`已添加 ${items.length - failures.length} 题，${failures.length} 题失败`, 'error');
    } else {
      toast(`已将 ${items.length} 道题添加至「${favorite.name}」`);
      clearSelection();
    }
  }

  function escapeHtml(value) {
    const element = document.createElement('span');
    element.textContent = String(value ?? '');
    return element.innerHTML;
  }

  function selectVisible() {
    document.querySelectorAll('.lclm-checkbox input').forEach((input) => {
      selected.set(input.dataset.slug, input.dataset.title);
    });
    syncRenderedRows();
  }

  function mountApp() {
    if (document.getElementById(APP_ID)) return;
    const app = document.createElement('div');
    app.id = APP_ID;
    app.innerHTML = `
      <div class="lclm-toolbar" role="toolbar" aria-label="题单批量操作">
        <div class="lclm-brand"><span class="lclm-logo">L</span><strong>批量管理</strong></div>
        <span class="lclm-count" data-role="count">0 题</span>
        <span class="lclm-status" data-role="status"></span>
        <span class="lclm-divider"></span>
        <button type="button" data-action="select-visible">选择可见</button>
        <button type="button" data-action="clear">清空</button>
        <button type="button" class="lclm-primary" data-action="add" data-needs-selection>添加至题单</button>
        <button type="button" data-action="pin" data-needs-selection>置顶</button>
        <button type="button" class="lclm-danger" data-action="remove" data-needs-selection>移除</button>
      </div>
      <dialog aria-labelledby="lclm-dialog-title">
        <div class="lclm-dialog-head">
          <div><small>批量操作</small><h2 id="lclm-dialog-title">添加至题单</h2></div>
          <button type="button" class="lclm-close" aria-label="关闭">×</button>
        </div>
        <div class="lclm-favorites" data-role="favorite-list"></div>
      </dialog>
      <div class="lclm-toasts" data-role="toasts" aria-live="polite"></div>
    `;
    document.body.append(app);

    app.querySelector('[data-action="select-visible"]').addEventListener('click', selectVisible);
    app.querySelector('[data-action="clear"]').addEventListener('click', clearSelection);
    app.querySelector('[data-action="add"]').addEventListener('click', openAddDialog);
    app.querySelector('[data-action="pin"]').addEventListener('click', pinSelected);
    app.querySelector('[data-action="remove"]').addEventListener('click', removeSelected);
    const dialog = app.querySelector('dialog');
    app.querySelector('.lclm-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    updateToolbar();
  }

  const style = document.createElement('style');
  style.textContent = `
    #${APP_ID}, #${APP_ID} * { box-sizing: border-box; }
    .lclm-row { transition: background-color .16s ease, box-shadow .16s ease; }
    .lclm-row.lclm-selected { background: rgba(255, 161, 22, .10) !important; box-shadow: inset 3px 0 #ffa116; }
    .lclm-checkbox { width: 28px; min-width: 28px; height: 44px; display: grid; place-items: center; cursor: pointer; position: relative; z-index: 3; }
    .lclm-checkbox input { position: absolute; opacity: 0; pointer-events: none; }
    .lclm-checkbox span { width: 17px; height: 17px; border: 1.5px solid #a2a2a2; border-radius: 5px; background: var(--sd-card-background, #fff); display: grid; place-items: center; transition: all .16s ease; }
    .lclm-checkbox input:checked + span { background: #ffa116; border-color: #ffa116; }
    .lclm-checkbox input:checked + span::after { content: ''; width: 8px; height: 4px; border-left: 2px solid white; border-bottom: 2px solid white; transform: translateY(-1px) rotate(-45deg); }
    .lclm-checkbox input:focus-visible + span { outline: 3px solid rgba(255,161,22,.3); outline-offset: 2px; }
    .lclm-toolbar { position: fixed; z-index: 9998; left: 50%; bottom: 24px; transform: translateX(-50%); min-height: 56px; display: flex; align-items: center; gap: 8px; padding: 8px 10px; color: #f7f7f7; background: rgba(27, 28, 30, .96); border: 1px solid rgba(255,255,255,.12); border-radius: 16px; box-shadow: 0 18px 45px rgba(0,0,0,.32); backdrop-filter: blur(14px); font: 13px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .lclm-brand { display: flex; align-items: center; gap: 7px; padding: 0 5px 0 1px; white-space: nowrap; }
    .lclm-logo { width: 28px; height: 28px; display: grid; place-items: center; color: #181818; background: #ffa116; border-radius: 9px; font: 800 16px/1 ui-monospace, monospace; }
    .lclm-count { min-width: 46px; color: #ffa116; font-weight: 700; white-space: nowrap; }
    .lclm-status { min-width: 0; color: #a8a8a8; white-space: nowrap; }
    .lclm-divider { width: 1px; height: 24px; background: rgba(255,255,255,.14); }
    .lclm-toolbar button, .lclm-favorite, .lclm-close { border: 0; font: inherit; cursor: pointer; }
    .lclm-toolbar button { height: 36px; padding: 0 12px; color: #ededed; background: #34363a; border-radius: 10px; white-space: nowrap; transition: transform .12s ease, background .12s ease, opacity .12s ease; }
    .lclm-toolbar button:hover:not(:disabled) { background: #43464b; transform: translateY(-1px); }
    .lclm-toolbar button:disabled { opacity: .38; cursor: not-allowed; }
    .lclm-toolbar .lclm-primary { color: #1b1b1b; background: #ffa116; font-weight: 700; }
    .lclm-toolbar .lclm-primary:hover:not(:disabled) { background: #ffb13d; }
    .lclm-toolbar .lclm-danger { color: #ffb4b4; background: rgba(239,71,71,.17); }
    #${APP_ID} dialog { width: min(440px, calc(100vw - 32px)); max-height: min(620px, calc(100vh - 48px)); padding: 0; color: var(--sd-card-foreground, #262626); background: var(--sd-card-background, #fff); border: 1px solid rgba(128,128,128,.22); border-radius: 18px; box-shadow: 0 24px 70px rgba(0,0,0,.3); font: 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #${APP_ID} dialog::backdrop { background: rgba(0,0,0,.42); backdrop-filter: blur(3px); }
    .lclm-dialog-head { display: flex; align-items: center; justify-content: space-between; padding: 20px 20px 12px; }
    .lclm-dialog-head small { color: #888; text-transform: uppercase; letter-spacing: .08em; }
    .lclm-dialog-head h2 { margin: 2px 0 0; font-size: 20px; }
    .lclm-close { width: 34px; height: 34px; color: inherit; background: rgba(128,128,128,.12); border-radius: 10px; font-size: 24px; line-height: 1; }
    .lclm-favorites { display: grid; gap: 8px; max-height: 490px; overflow: auto; padding: 8px 14px 18px; }
    .lclm-favorite { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 52px; padding: 9px 12px; color: inherit; text-align: left; background: rgba(128,128,128,.08); border: 1px solid transparent; border-radius: 12px; }
    .lclm-favorite:hover { border-color: #ffa116; background: rgba(255,161,22,.09); }
    .lclm-favorite span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 650; }
    .lclm-favorite small { color: #929292; }
    .lclm-loading, .lclm-empty { padding: 36px 14px; color: #888; text-align: center; }
    .lclm-toasts { position: fixed; z-index: 10000; right: 20px; bottom: 92px; display: grid; gap: 8px; pointer-events: none; }
    .lclm-toast { max-width: 360px; padding: 11px 14px; color: white; background: #25272a; border-left: 3px solid #39b879; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
    .lclm-toast-error { border-left-color: #ef5350; }
    @media (max-width: 720px) {
      .lclm-toolbar { left: 10px; right: 10px; bottom: 10px; transform: none; overflow-x: auto; justify-content: flex-start; }
      .lclm-brand strong, .lclm-divider { display: none; }
    }
    @media (prefers-reduced-motion: reduce) { .lclm-row, .lclm-toolbar button { transition: none; } }
  `;
  document.head.append(style);
  mountApp();
  decorateRows();
  new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
  setInterval(queueScan, 1200);
})();
