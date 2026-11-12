import {observerViewArea} from './observer-view-area.js';
/** Read-only presentation of the existing observer. Reuses nodes, routes and data feed. */
import type {ObserverMap} from './observer-map.js';
import {residentFollowTarget} from './resident-follow.js';

export interface StorybookUIShell {readonly active: boolean; activate(): void; deactivate(): void; dispose(): void;}
const mounted = new WeakMap<ObserverMap, StorybookUIShell>();
export const STORYBOOK_UI_NOTICE = '绘本观察界面 · 沿用世界记录与原地图；地图手绘素材仍在独立制作。';

/** Location is a recorded fact, never a planned destination or a home assignment. */
export function storybookResidentLocation(observer: ObserverMap, id: string): string {
  const snapshot = observer.currentSnapshot();
  if (!snapshot) return '位置未知 · 尚无世界记录';
  const resident = snapshot.world.residents.find(person => person.id === id);
  if (!resident) return '位置未知 · 当前记录中找不到此人';
  if (resident.regionalLocation) return '镇外旅途 · 谷内位置不可观察';
  const target = residentFollowTarget(snapshot.world, id);
  if ('reason' in target) return target.reason === 'outside' ? '镇外 · 谷内位置不可观察' : target.reason === 'dead' ? '已故 · 不推定当前位置' : '位置未知 · 当前记录不足以定位';
  if (target.roomId) return `${target.roomName} · ${target.precise ? `室内 ${resident.roomAt!.x}, ${resident.roomAt!.y}` : '室内精确位置未知'}`;
  return `室外 · 地图 ${resident.at.x}, ${resident.at.y}`;
}

export function mountStorybookUIShell(observer: ObserverMap, options: {mode?: 'preview' | 'live'} = {}): StorybookUIShell {
  const live = options.mode === 'live';
  const previous = mounted.get(observer); if (previous) return previous;
  const requireNode = (selector: string) => {const node = document.querySelector<HTMLElement>(selector); if (!node) throw new Error(`storybook_ui_missing:${selector}`); return node;};
  // Validate before touching the original page. No clone means no duplicate IDs or handlers.
  const app = requireNode('#app'), hud = requireNode('#observer-hud'), topbar = requireNode('.topbar');
  const selection = requireNode('#selection'), panel = requireNode('#panel'), dock = requireNode('.dock'), controls = requireNode('.map-controls');
  const closePanel = panel.querySelector<HTMLButtonElement>('[data-action="closepanel"]');
  if (!closePanel) throw new Error('storybook_ui_missing:closepanel');
  const names = ['people', 'relations', 'conversations', 'places', 'wild', 'chronicle'];
  const buttons = names.map(name => {const node = dock.querySelector<HTMLButtonElement>(`[data-panel="${name}"]`); if (!node) throw new Error(`storybook_ui_missing:${name}`); return node;});
  const previousExpanded = buttons.map(node => node.getAttribute('aria-expanded'));
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') => {const node = document.createElement(tag); node.className = className; node.textContent = text; return node;};
  const button = (className: string, text: string) => {const node = make('button', className, text); node.type = 'button'; return node;};
  const launch = button('storybook-ui-launch', '打开绘本界面壳（开发）'); launch.setAttribute('aria-pressed', 'false');
  const root = make('section', 'storybook-ui-shell'); root.hidden = true; root.setAttribute('aria-label', '山谷观察界面');
  const top = make('div', 'storybook-ui-top'), card = make('div', 'storybook-ui-card');
  const cardToggle = button('storybook-ui-card-toggle', '展开对象卡'); cardToggle.setAttribute('aria-controls', 'selection'); cardToggle.setAttribute('aria-expanded', 'false');
  const location = make('p', 'storybook-ui-location');
  const unknownClock = make('p', 'storybook-ui-unknown-clock', '日期与时间未知'); unknownClock.hidden = true;
  const more = button('storybook-ui-more', '更多'); more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-controls', 'storybook-ui-more');
  const morePanel = make('nav', 'dock storybook-ui-more-panel'); morePanel.id = 'storybook-ui-more'; morePanel.hidden = true; morePanel.setAttribute('aria-label', '更多观察入口');
  const moreClose = button('storybook-ui-more-close', '收起更多');
  const panelExpand = button('storybook-ui-panel-expand', '展开长记录'); panelExpand.setAttribute('aria-controls', 'panel'); panelExpand.setAttribute('aria-expanded', 'false');
  const notice = make('p', 'storybook-ui-notice', STORYBOOK_UI_NOTICE); notice.setAttribute('role', 'status');
  const tools = make('details', 'storybook-ui-tools'), toolsSummary = make('summary', '', live ? '观察视图' : '开发界面 · 工具与说明');
  const exit = button('storybook-ui-exit', '返回原界面'); tools.append(toolsSummary); if (!live) tools.append(notice);
  root.append(top, card, morePanel); card.append(cardToggle, location); morePanel.append(moreClose);
  const media = window.matchMedia('(max-width: 700px)');
  let active = false, disposed = false, collapsed = true, expanded = false, lastPanelOpen = false;
  let returnTo: HTMLElement | null = null;
  let returnRoute: {attribute: string; value: string} | null = null;
  const routeAttributes = ['data-panel', 'data-person', 'data-biography', 'data-thread', 'data-animal-detail', 'data-animal-history', 'data-disaster-history'];
  const restoreFocus = () => {
    let target = returnTo;
    if (!target?.isConnected && returnRoute) {
      const route = returnRoute;
      target = [...selection.querySelectorAll<HTMLElement>(`[${route.attribute}]`)].find(node => node.getAttribute(route.attribute) === route.value) ?? null;
    }
    if (target && media.matches && morePanel.contains(target)) target = more;
    if (!target?.isConnected || (selection.contains(target) && selection.classList.contains('hidden'))) target = buttons[0];
    else if (media.matches && collapsed && selection.contains(target)) target = cardToggle;
    target.focus({preventScroll: true});
    returnTo = null; returnRoute = null;
  };
  const releases: Array<() => void> = [], activeReleases: Array<() => void> = [];
  const moves: Array<{node: HTMLElement; marker: Comment}> = [];
  const attempt = (fn: () => void) => {try {fn();} catch { /* Finish restoring other original nodes. */ }};
  const listen = (target: EventTarget, type: string, fn: EventListener, capture = false) => {target.addEventListener(type, fn, capture); releases.push(() => target.removeEventListener(type, fn, capture));};
  const move = (node: HTMLElement, parent: HTMLElement) => {const marker = document.createComment('storybook-ui-return'); node.before(marker); moves.push({node, marker}); parent.append(node);};
  const text = (node: HTMLElement, value: string) => {if (node.textContent !== value) node.textContent = value;};
  const showMore = (open: boolean, focus = false) => {
    morePanel.hidden = !open; more.setAttribute('aria-expanded', String(open));
    if (focus) (open ? buttons[1] : more).focus({preventScroll: true});
  };
  const layout = () => {
    if (!active) return;
    const focused = document.activeElement;
    showMore(false);
    for (const node of buttons) dock.append(node);
    if (media.matches) for (const index of [1, 2, 4]) morePanel.insertBefore(buttons[index], moreClose);
    dock.append(more); more.hidden = !media.matches;
    // A breakpoint must not leave keyboard focus inside a now-hidden navigation.
    if (focused instanceof HTMLElement && morePanel.contains(focused)) (media.matches ? more : buttons[0]).focus({preventScroll: true});
    else if (focused === more && !media.matches) buttons[0].focus({preventScroll: true});
    else if (buttons.some(node => node === focused)) (focused as HTMLElement).focus({preventScroll: true});
  };
  const refresh = () => {
    if (!active) return;
    const panelOpen = !panel.classList.contains('hidden');
    const selected = !selection.classList.contains('hidden');
    card.hidden = !selected || panelOpen;
    root.classList.toggle('storybook-ui-panel-open', panelOpen);
    if (panelOpen !== lastPanelOpen) {
      expanded = false; root.classList.remove('storybook-ui-reading-expanded'); panelExpand.setAttribute('aria-expanded', 'false'); text(panelExpand, '展开长记录');
      if (!panelOpen && returnTo) restoreFocus();
      lastPanelOpen = panelOpen;
    }
    for (const node of buttons) node.setAttribute('aria-expanded', String(panelOpen && node.classList.contains('active')));
    const id = selection.querySelector<HTMLElement>('[data-person]')?.dataset.person;
    location.hidden = !id;
    if (id) {
      try {text(location, storybookResidentLocation(observer, id));}
      catch {text(location, '位置未知 · 记录无法读取，原档案仍可查看');}
    }
    // Initial HTML contains a sample date. Never present it as an observed date.
    const missing = !observer.currentSnapshot(); top.classList.toggle('storybook-ui-no-snapshot', missing); unknownClock.hidden = !missing;
  };
  let lastArea = '';
  const publishArea = (area: ReturnType<typeof observerViewArea>, id: string | null) => {
    const key = JSON.stringify([area, id]); if (key === lastArea) return;
    lastArea = key; observer.setViewArea?.(area, id);
  };
  const measureArea = () => {
    if (!active || !observer.setViewArea) return;
    const id = selection.classList.contains('hidden') ? null : selection.querySelector<HTMLElement>('[data-person]')?.dataset.person ?? null;
    if (!media.matches) {publishArea(null, id); return;}
    // Layout measurements, never assumed drawer percentages. DOM-less tests use the pure solver.
    if (typeof root.getBoundingClientRect !== 'function') return;
    const frame = root.getBoundingClientRect();
    const nodes = [top, card, panel, dock, controls, morePanel];
    const rects = nodes.filter(node => !node.hidden && !node.classList.contains('hidden')).map(node => node.getBoundingClientRect())
      .map(rect => ({x:rect.left-frame.left,y:rect.top-frame.top,width:rect.width,height:rect.height}));
    const area = observerViewArea(frame.width, frame.height, rects);
    publishArea(area ?? {x:0,y:0,width:0,height:0,frameWidth:frame.width,frameHeight:frame.height}, id);
  };
  const mutation = new MutationObserver(() => {refresh(); measureArea();});
  const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(measureArea) : null;
  const deactivate = () => {
    if (!active) return; active = false;
    mutation.disconnect(); sizes?.disconnect(); lastArea = ''; observer.setViewArea?.(null, null); while (activeReleases.length) attempt(activeReleases.pop()!);
    showMore(false); for (const node of buttons) dock.append(node); more.remove(); panelExpand.remove(); unknownClock.remove();
    while (moves.length) {const {node, marker} = moves.pop()!; attempt(() => {marker.replaceWith(node);});}
    buttons.forEach((node, index) => {const old = previousExpanded[index]; if (old === null) node.removeAttribute('aria-expanded'); else node.setAttribute('aria-expanded', old);});
    app.classList.remove('storybook-ui-active'); root.hidden = true; launch.hidden = live; launch.setAttribute('aria-pressed', 'false');
    returnTo = null; lastPanelOpen = false; if (!live) launch.focus({preventScroll: true});
  };
  const handle: StorybookUIShell = {
    get active() {return active;},
    activate() {
      if (active || disposed) return;
      try {
        active = true; app.classList.add('storybook-ui-active'); root.hidden = false; launch.hidden = true; launch.setAttribute('aria-pressed', 'true');
        collapsed = true; card.classList.add('storybook-ui-collapsed'); cardToggle.setAttribute('aria-expanded', 'false'); text(cardToggle, '展开对象卡');
        expanded = false; root.classList.remove('storybook-ui-reading-expanded');
        move(topbar, top); topbar.append(unknownClock); move(hud, top);
        // Time, connection and room status remain visible even when preview tools are folded.
        for (const node of [...hud.children]) if (node instanceof HTMLElement && node !== launch && !['world-state', 'room-banner'].includes(node.id)) move(node, tools);
        top.append(tools); if (!live) top.append(exit); move(selection, card); card.append(location); move(panel, root); move(dock, root); move(controls, root);
        panel.querySelector('.panel-header')!.append(panelExpand);
        layout();
        mutation.observe(selection, {subtree: true, childList: true, attributes: true, attributeFilter: ['class']});
        mutation.observe(panel, {attributes: true, attributeFilter: ['class']});
        for (const node of buttons) mutation.observe(node, {attributes: true, attributeFilter: ['class']});
        activeReleases.push(observer.subscribe(() => {refresh(); measureArea();})); refresh();
        for (const node of [root, top, card, panel, dock, controls, morePanel]) sizes?.observe(node);
        measureArea(); if (!live) exit.focus({preventScroll: true});
        tools.hidden = live && tools.children.length <= 1;
        tools.open = false;
      } catch {deactivate(); launch.textContent = '界面壳加载失败 · 重试（原界面保留）';}
    },
    deactivate,
    dispose() {if (disposed) return; disposed = true; deactivate(); mutation.disconnect(); while (releases.length) attempt(releases.pop()!); root.remove(); launch.remove(); mounted.delete(observer);},
  };
  try {
    if (!live) hud.append(launch); app.append(root);
    listen(launch, 'click', handle.activate); listen(exit, 'click', deactivate);
    listen(more, 'click', () => showMore(morePanel.hidden, true)); listen(moreClose, 'click', () => showMore(false, true));
    listen(cardToggle, 'click', () => {collapsed = !collapsed; card.classList.toggle('storybook-ui-collapsed', collapsed); cardToggle.setAttribute('aria-expanded', String(!collapsed)); text(cardToggle, collapsed ? '展开对象卡' : '收起对象卡');});
    listen(panelExpand, 'click', () => {expanded = !expanded; root.classList.toggle('storybook-ui-reading-expanded', expanded); panelExpand.setAttribute('aria-expanded', String(expanded)); text(panelExpand, expanded ? '收起长记录' : '展开长记录');});
    listen(media, 'change', () => {layout(); measureArea();});
    listen(window, 'resize', measureArea);
    listen(root, 'click', measureArea);
    listen(window, 'click', event => {
      if (!active || !(event.target instanceof Element)) return;
      const target = event.target.closest<HTMLElement>('[data-panel],[data-person],[data-biography],[data-thread],[data-animal-detail],[data-animal-history],[data-disaster-history]');
      if (target && !panel.contains(target)) {returnTo = target; returnRoute = null; for (const attribute of routeAttributes) {const value = target.getAttribute(attribute); if (value !== null) {returnRoute = {attribute, value}; break;}} showMore(false);}
      else if (!morePanel.contains(event.target) && event.target !== more && !more.contains(event.target)) showMore(false);
    }, true);
    // Consume only the topmost UI layer. Closing a reading panel never exits a room or clears a follow.
    listen(window, 'keydown', event => {
      if (!active || (event as KeyboardEvent).key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!morePanel.hidden) showMore(false, true);
      else if (!panel.classList.contains('hidden')) {closePanel.click(); refresh();}
      else if (media.matches && !card.hidden && !collapsed) {cardToggle.click(); cardToggle.focus({preventScroll: true});}
      else if (!live) deactivate();
    }, true);
    mounted.set(observer, handle); if (live) handle.activate(); return handle;
  } catch (error) {handle.dispose(); throw error;}
}
