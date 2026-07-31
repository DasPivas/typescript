import { ALL_DEFS, CATEGORY_NAMES, DEFS, PATROL_STAFF, STAFF } from '../core/catalog';
import { fairPrice, serveNeed, type Game } from '../core/game';
import { LEVELS } from '../core/levels';
import type { Building, Category, Rot } from '../core/types';

export interface AppApi {
  game: Game;
  icons: Record<string, string>;
  selectedKey: string | null;
  removeMode: boolean;
  rot: Rot;
  selectKey(key: string | null): void;
  setRemoveMode(v: boolean): void;
  rotate(): void;
  startLevel(key: string): void;
  save(): void;
  load(): void;
  hasSave(): boolean;
  levelDone(key: string): boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

const CATS: Category[] = ['road', 'ride', 'service', 'decor'];

const HELP = `
<p><b>Цель.</b> Построить парк, куда племя ходит толпами. Больше разных аттракционов —
выше рейтинг, выше рейтинг — больше посетителей и денег.</p>
<p><b>Управление.</b> Один палец — двигать карту, два — приближать. Тап по объекту
открывает его карточку. В режиме дорог палец рисует дорогу перетаскиванием.</p>
<p><b>Дороги.</b> Посетители ходят только по дорогам. У каждого аттракциона и сервиса
есть вход — светлая рамка на клетке. Он обязан примыкать к дороге.</p>
<p><b>Диномотор.</b> Аттракционы с шестерёнкой работают только внутри его зоны.
Ставьте мотор первым — зона подсветится.</p>
<p><b>Цены.</b> У каждого аттракциона своя цена билета. Дорого — настроение падает,
дёшево — растёт, но и денег меньше. Ориентир — «честная цена» в карточке.</p>
<p><b>Люди.</b> Посетители устают, хотят есть, пить и в туалет. Не закрытые желания
роняют настроение, злой гость уходит и может устроить драку.</p>
<p><b>Работники.</b> Повар и продавец нанимаются прямо в здании, ремонтник и охранник —
на весь парк. Зарплата списывается каждое новолуние.</p>
`;

export class UI {
  root: HTMLElement;
  private app: AppApi;
  private hud = el('div', 'hud');
  private dock = el('div', 'dock');
  private build = el('div', 'build');
  private tabs = el('div', 'tabs');
  private items = el('div', 'items');
  private toasts = el('div', 'toasts');
  private hint = el('div', 'hint');
  private modalHost = el('div');
  private picked = el('div', 'picked');
  private tab: Category = 'road';
  private buildOpen = false;

  constructor(root: HTMLElement, app: AppApi) {
    this.root = root;
    this.app = app;
    root.append(this.hud, this.hint, this.toasts, this.picked, this.dock, this.build, this.modalHost);
    this.buildDock();
    this.buildPanel();
    this.renderTabs();
    this.renderItems();
    this.renderPicked();
  }

  /** Компактная плашка с выбранной постройкой — панель при этом можно закрыть. */
  renderPicked(): void {
    const key = this.app.selectedKey;
    this.picked.replaceChildren();
    if (!key && !this.app.removeMode) {
      this.picked.style.display = 'none';
      return;
    }
    this.picked.style.display = 'flex';
    if (this.app.removeMode) {
      this.picked.append(el('b', undefined, '⛏ режим сноса'));
    } else {
      const def = DEFS[key!];
      const icon = this.app.icons[key!];
      if (icon) {
        const img = el('img');
        img.src = icon;
        this.picked.append(img);
      }
      this.picked.append(el('b', undefined, def.name));
      if (def.cat !== 'road' && def.cat !== 'decor') {
        const rot = el('button', undefined, '⟳');
        rot.onclick = () => this.app.rotate();
        this.picked.append(el('div', 'grow'), rot);
      } else {
        this.picked.append(el('div', 'grow'));
      }
    }
    const cancel = el('button', 'danger', '✕');
    cancel.onclick = () => {
      this.app.selectKey(null);
      this.app.setRemoveMode(false);
      this.renderItems();
      this.renderPicked();
      this.refreshHint();
    };
    this.picked.append(cancel);
  }

  // ─────────── постоянные элементы ───────────

  private buildDock(): void {
    const side = el('div', 'side');
    const btnBuild = el('button', 'on', '🔨 строить');
    btnBuild.onclick = () => this.toggleBuild();
    const btnStaff = el('button', undefined, '👷');
    btnStaff.onclick = () => this.openStaff();
    const btnStats = el('button', undefined, '📊');
    btnStats.onclick = () => this.openStats();
    const btnMenu = el('button', undefined, '☰');
    btnMenu.onclick = () => this.openMenu();
    const spacer = el('div');
    spacer.style.flex = '1';
    side.append(btnStaff, btnStats, btnMenu);
    this.dock.append(btnBuild, spacer, side);
  }

  private buildPanel(): void {
    const bar = el('div');
    bar.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px';
    const close = el('button', undefined, '✕');
    close.onclick = () => this.toggleBuild(false);
    const rot = el('button', undefined, '⟳ поворот');
    rot.onclick = () => {
      this.app.rotate();
      this.renderItems();
    };
    const del = el('button', 'danger', '⛏ снос');
    del.onclick = () => {
      this.app.setRemoveMode(!this.app.removeMode);
      this.toggleBuild(false, true);
      this.renderItems();
      this.renderPicked();
      this.refreshHint();
    };
    const grow = el('div');
    grow.style.flex = '1';
    bar.append(close, grow, rot, del);
    this.build.append(bar, this.tabs, this.items);
  }

  private toggleBuild(force?: boolean, keepSelection = false): void {
    this.buildOpen = force ?? !this.buildOpen;
    this.build.classList.toggle('open', this.buildOpen);
    if (!this.buildOpen && !keepSelection) {
      this.app.selectKey(null);
      this.app.setRemoveMode(false);
    }
    this.renderItems();
    this.renderPicked();
    this.refreshHint();
  }

  private renderTabs(): void {
    this.tabs.replaceChildren();
    for (const c of CATS) {
      const b = el('button', this.tab === c ? 'on' : undefined, CATEGORY_NAMES[c]);
      b.onclick = () => {
        this.tab = c;
        this.renderTabs();
        this.renderItems();
      };
      this.tabs.append(b);
    }
  }

  renderItems(): void {
    const g = this.app.game;
    this.items.replaceChildren();
    for (const def of ALL_DEFS.filter((d) => d.cat === this.tab).sort((a, b) => a.order - b.order)) {
      const unlocked = g.isUnlocked(def.key);
      const sel = this.app.selectedKey === def.key && !this.app.removeMode;
      const card = el('div', `card${sel ? ' sel' : ''}${unlocked ? '' : ' locked'}`);
      const icon = this.app.icons[def.key];
      const extra =
        def.cat === 'ride'
          ? `<div>★ ${def.rating}</div>`
          : def.serves
            ? `<div>${needLabel(def.serves)}</div>`
            : def.key === 'dinomotor'
              ? '<div>⚙ зона</div>'
              : '';
      card.innerHTML = `${icon ? `<img src="${icon}" alt="">` : ''}<div>${def.name}</div>${extra}<div class="price">${def.cost}</div>${
        def.needsMotor ? '<div>⚙</div>' : ''
      }`;
      if (unlocked) {
        card.onclick = () => {
          this.app.setRemoveMode(false);
          const next = this.app.selectedKey === def.key ? null : def.key;
          this.app.selectKey(next);
          // Панель сразу уезжает вниз, чтобы не закрывать карту.
          if (next) this.toggleBuild(false, true);
          else {
            this.renderItems();
            this.renderPicked();
            this.refreshHint();
          }
        };
      }
      this.items.append(card);
    }
  }

  private refreshHint(): void {
    const key = this.app.selectedKey;
    if (this.app.removeMode) {
      this.hint.textContent = 'режим сноса: тапните по объекту или дороге';
      return;
    }
    if (!key) {
      this.hint.textContent = '';
      return;
    }
    const def = DEFS[key];
    this.hint.textContent =
      def.cat === 'road'
        ? 'ведите пальцем — дорога рисуется'
        : `тап — примерить, тап ещё раз — поставить${def.needsMotor ? ' · нужен диномотор' : ''}`;
  }

  // ─────────── обновление каждый кадр ───────────

  update(): void {
    const g = this.app.game;
    const goals = g.level.goals;
    const moon = g.moonPhase;
    const shadow = Math.round(Math.cos(moon * Math.PI * 2) * 10);
    this.hud.innerHTML = '';
    const chips: [string, string][] = [
      ['💰', `${Math.round(g.money)}`],
      ['⭐', `${Math.round(g.rating)}`],
      [moodFace(g.avgMood), `${Math.round(g.avgMood)}`],
      ['👥', `${g.visitors.length}`],
    ];
    for (const [i, v] of chips) {
      const c = el('div', 'chip', `${i} <b>${v}</b>`);
      this.hud.append(c);
    }
    const time = el('div', 'chip');
    const m = el('div', 'moon');
    m.style.boxShadow = `inset ${shadow}px 0 0 0 rgba(20,15,8,.85)`;
    time.append(m, document.createTextNode(` ${g.month + 1} мес`));
    this.hud.append(time, el('div', 'grow'));

    const speed = el('div', 'speed');
    for (const [label, val] of [
      ['❚❚', 0],
      ['▶', 1],
      ['▶▶', 3],
    ] as [string, number][]) {
      const on = val === 0 ? g.paused : !g.paused && g.speed === val;
      const b = el('button', on ? 'on' : undefined, label);
      b.onclick = () => {
        if (val === 0) g.paused = true;
        else {
          g.paused = false;
          g.speed = val;
        }
      };
      speed.append(b);
    }
    this.hud.append(speed);

    // подсказки
    this.toasts.replaceChildren();
    for (const t of g.toasts) this.toasts.append(el('div', 'toast', t.text));

    if (goals.months) {
      const left = goals.months - g.month;
      if (left <= 3 && left > 0 && !this.hint.textContent) {
        this.hint.textContent = `осталось месяцев: ${left}`;
      }
    }
  }

  // ─────────── модальные окна ───────────

  private modal(title: string, body: HTMLElement, actions: [string, () => void, string?][]): void {
    this.closeModal();
    const wrap = el('div', 'modal');
    const sheet = el('div', 'sheet');
    sheet.append(el('h2', undefined, title), body);
    const act = el('div', 'actions');
    for (const [label, fn, cls] of actions) {
      const b = el('button', cls, label);
      b.onclick = () => fn();
      act.append(b);
    }
    sheet.append(act);
    wrap.append(sheet);
    wrap.onclick = (e) => {
      if (e.target === wrap) this.closeModal();
    };
    this.modalHost.append(wrap);
  }

  closeModal(): void {
    this.modalHost.replaceChildren();
  }

  get modalOpen(): boolean {
    return this.modalHost.childElementCount > 0;
  }

  openBuilding(b: Building): void {
    const g = this.app.game;
    const def = DEFS[b.key];
    const body = el('div');
    const draw = () => {
      body.replaceChildren();
      const rows: [string, string][] = [];
      if (def.cat === 'ride') rows.push(['рейтинг', `${def.rating}`]);
      if (def.serves) rows.push(['закрывает', needLabel(def.serves)]);
      rows.push(['доход', `${Math.round(b.revenue)}`]);
      rows.push(['посещений', `${b.uses}`]);
      rows.push(['в очереди', `${b.queue.length}`]);
      rows.push(['обслуживание', `${def.upkeep}/мес`]);
      for (const [k, v] of rows) body.append(el('div', 'row', `<span>${k}</span><b>${v}</b>`));

      if (def.cat === 'ride') {
        const cond = el('div', 'row');
        cond.innerHTML = `<span>состояние</span>`;
        const bar = el('div', 'bar');
        const i = el('i');
        i.style.width = `${Math.max(0, b.condition)}%`;
        i.style.background = b.condition < 35 ? '#d94141' : '#5aa32e';
        bar.append(i);
        cond.append(bar);
        body.append(cond);
        if (b.broken) body.append(el('div', 'row', '<b style="color:#ff9a9a">сломан — нужен ремонтник</b>'));
      }

      if (def.capacity && def.basePrice !== undefined) {
        const fair = Math.round(fairPrice(def));
        const price = el('div', 'row');
        price.innerHTML = `<span>цена<br><small style="opacity:.7">честная ~${fair}</small></span>`;
        const box = el('div');
        box.style.cssText = 'display:flex;gap:6px;align-items:center';
        const minus = el('button', undefined, '−');
        const val = el('b', undefined, `${b.price}`);
        const plus = el('button', undefined, '+');
        minus.onclick = () => {
          g.setPrice(b.id, b.price - 1);
          val.textContent = `${b.price}`;
        };
        plus.onclick = () => {
          g.setPrice(b.id, b.price + 1);
          val.textContent = `${b.price}`;
        };
        box.append(minus, val, plus);
        price.append(box);
        body.append(price);
      }

      if (def.needsStaff) {
        const sd = STAFF[def.needsStaff];
        const row = el('div', 'row');
        row.innerHTML = `<span>${sd.name}<br><small style="opacity:.7">${sd.duty} · ${sd.salary}/мес</small></span>`;
        const btn = el('button', b.staffId === null ? undefined : 'danger', b.staffId === null ? `нанять (${sd.hireCost})` : 'уволить');
        btn.onclick = () => {
          if (b.staffId === null) g.hireFor(b.id);
          else g.fire(b.staffId);
          draw();
        };
        row.append(btn);
        body.append(row);
      }
    };
    draw();
    this.modal(def.name, body, [
      ['снести', () => {
        if (g.removeAt(b.x, b.y)) this.closeModal();
      }, 'danger'],
      ['закрыть', () => this.closeModal()],
    ]);
  }

  openStaff(): void {
    const g = this.app.game;
    const body = el('div');
    const draw = () => {
      body.replaceChildren();
      for (const kind of PATROL_STAFF) {
        const sd = STAFF[kind];
        const row = el('div', 'row');
        const count = g.staff.filter((s) => s.kind === kind).length;
        row.innerHTML = `<span>${sd.name} ×${count}<br><small style="opacity:.7">${sd.duty} · ${sd.salary}/мес</small></span>`;
        const box = el('div');
        box.style.cssText = 'display:flex;gap:6px';
        const hire = el('button', undefined, `+ ${sd.hireCost}`);
        hire.onclick = () => {
          g.hirePatrol(kind);
          draw();
        };
        const fire = el('button', 'danger', '−');
        fire.disabled = count === 0;
        fire.onclick = () => {
          const s = g.staff.find((o) => o.kind === kind);
          if (s) g.fire(s.id);
          draw();
        };
        box.append(hire, fire);
        row.append(box);
        body.append(row);
      }
      const service = g.staff.filter((s) => s.buildingId !== null);
      body.append(
        el(
          'div',
          'row',
          `<span>в зданиях</span><b>${service.length}</b>`,
        ),
      );
      body.append(
        el('div', 'row', `<span>зарплаты и обслуживание</span><b>${g.monthlyCosts}/мес</b>`),
      );
    };
    draw();
    this.modal('работники', body, [['закрыть', () => this.closeModal()]]);
  }

  openStats(): void {
    const g = this.app.game;
    const body = el('div');
    const rides = g.buildings.filter((b) => DEFS[b.key].cat === 'ride').length;
    const rows: [string, string][] = [
      ['доход', `${Math.round(g.stats.income)}`],
      ['расход', `${Math.round(g.stats.expense)}`],
      ['баланс', `${Math.round(g.money)}`],
      ['рейтинг парка', `${Math.round(g.rating)}`],
      ['аттракционов', `${rides}`],
      ['прокатов', `${g.stats.ridesTaken}`],
      ['ушли довольными', `${g.stats.visitorsServed}`],
      ['ушли злыми', `${g.stats.visitorsLeftAngry}`],
    ];
    for (const [k, v] of rows) body.append(el('div', 'row', `<span>${k}</span><b>${v}</b>`));

    const goals = g.level.goals;
    if (Object.keys(goals).length) {
      body.append(el('h2', undefined, 'условия победы'));
      const g4: [string, number | undefined, number][] = [
        ['деньги', goals.money, g.money],
        ['рейтинг', goals.rating, g.rating],
        ['довольных гостей', goals.visitorsServed, g.stats.visitorsServed],
        ['аттракционов', goals.rides, rides],
      ];
      for (const [k, target, cur] of g4) {
        if (!target) continue;
        const done = cur >= target;
        body.append(
          el(
            'div',
            'row',
            `<span>${k}</span><b class="${done ? 'goal-ok' : ''}">${Math.round(cur)} / ${target}</b>`,
          ),
        );
      }
      if (goals.months) {
        body.append(
          el('div', 'row', `<span>срок</span><b>${g.month + 1} / ${goals.months} мес</b>`),
        );
      }
    }
    this.modal('статистика', body, [['закрыть', () => this.closeModal()]]);
  }

  openMenu(): void {
    const body = el('div');
    body.append(
      el('div', 'row', `<span>уровень</span><b>${this.app.game.level.name}</b>`),
    );
    this.modal('меню', body, [
      ['сохранить', () => {
        this.app.save();
        this.closeModal();
      }],
      ['загрузить', () => {
        this.app.load();
        this.closeModal();
      }],
      ['помощь', () => this.openHelp()],
      ['уровни', () => this.openLevels()],
      ['закрыть', () => this.closeModal()],
    ]);
  }

  openHelp(): void {
    const body = el('div');
    body.innerHTML = HELP;
    this.modal('помощь', body, [['закрыть', () => this.closeModal()]]);
  }

  openLevels(): void {
    const body = el('div', 'level-list');
    for (const l of LEVELS) {
      const done = this.app.levelDone(l.key);
      const b = el(
        'button',
        done ? 'on' : undefined,
        `${done ? '✔ ' : ''}${l.name}<small>${goalText(l.goals)}</small>`,
      );
      b.onclick = () => {
        this.closeModal();
        this.app.startLevel(l.key);
      };
      body.append(b);
    }
    const sb = el('button', undefined, 'свободная игра<small>без целей, всё открыто</small>');
    sb.onclick = () => {
      this.closeModal();
      this.app.startLevel('sandbox');
    };
    body.append(sb);
    this.modal('выбор уровня', body, [
      ...(this.app.hasSave()
        ? ([['продолжить сохранённую', () => {
            this.app.load();
            this.closeModal();
          }]] as [string, () => void][])
        : []),
      ['помощь', () => this.openHelp()],
    ]);
  }

  openIntro(): void {
    const g = this.app.game;
    const body = el('div');
    body.append(el('p', undefined, g.level.intro));
    body.append(el('div', 'row', `<span>стартовый капитал</span><b>${g.level.money}</b>`));
    if (Object.keys(g.level.goals).length) {
      body.append(el('div', 'row', `<span>цель</span><b>${goalText(g.level.goals)}</b>`));
    }
    this.modal(`уровень: ${g.level.name}`, body, [['начать', () => this.closeModal()]]);
  }

  openResult(won: boolean): void {
    const g = this.app.game;
    const body = el('div');
    body.append(
      el(
        'p',
        undefined,
        won
          ? 'Парк работает как надо — племя довольно, казна полна.'
          : 'Парк не выдержал. Можно попробовать ещё раз.',
      ),
    );
    body.append(el('div', 'row', `<span>рейтинг</span><b>${Math.round(g.rating)}</b>`));
    body.append(el('div', 'row', `<span>баланс</span><b>${Math.round(g.money)}</b>`));
    body.append(el('div', 'row', `<span>довольных гостей</span><b>${g.stats.visitorsServed}</b>`));
    this.modal(won ? 'поздравляем!' : 'вы проиграли!', body, [
      ['уровни', () => this.openLevels()],
      ['заново', () => {
        this.closeModal();
        this.app.startLevel(g.level.key);
      }],
    ]);
  }
}

function moodFace(m: number): string {
  return m > 65 ? '🙂' : m > 40 ? '😐' : '☹️';
}

function needLabel(n: string): string {
  return (
    {
      hunger: 'голод',
      thirst: 'жажда',
      bladder: 'туалет',
      energy: 'отдых',
      health: 'здоровье',
      fun: 'веселье',
    }[n] ?? n
  );
}

function goalText(g: { money?: number; rating?: number; visitorsServed?: number; rides?: number; months?: number }): string {
  const parts: string[] = [];
  if (g.money) parts.push(`${g.money} монет`);
  if (g.rating) parts.push(`рейтинг ${g.rating}`);
  if (g.visitorsServed) parts.push(`${g.visitorsServed} довольных гостей`);
  if (g.rides) parts.push(`${g.rides} аттракционов`);
  if (g.months) parts.push(`за ${g.months} мес`);
  return parts.join(' · ') || 'без целей';
}

export { serveNeed };
