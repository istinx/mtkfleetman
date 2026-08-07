import { useEffect, useState } from "react";
import {
  login,
  listRouters,
  createRouter,
  RouterSummary,
  getMe,
  Me,
  changeMyPassword,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  TenantUser,
  getLogs,
  LogEntry,
} from "./api";
import RouterDetail, { StatusBadge } from "./RouterDetail";
import NetworkMap from "./NetworkMap";
import LoginArt from "./LoginArt";

function LoginScreen({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      onLoggedIn();
    } catch {
      setError("Неверный логин или пароль.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-art"><LoginArt /></div>
        <form onSubmit={submit}>
          <h1>MikroTik Fleet Manager</h1>
          <p>Войдите, чтобы увидеть парк роутеров</p>
          <input type="text" placeholder="логин" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <input type="password" placeholder="пароль" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="primary" type="submit" disabled={busy}>{busy ? "Входим…" : "Войти"}</button>
          {error && <div className="error-text">{error}</div>}
        </form>
      </div>
    </div>
  );
}

function AddRouterModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", host: "", port: 443, username: "admin", password: "", model: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createRouter({ ...form, useTls: true });
      onCreated();
      onClose();
    } catch {
      setError("Не удалось добавить роутер. Проверьте права доступа.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Добавить роутер</h2>
        <label>Имя</label>
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label>Хост / IP</label>
        <input required value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
        <label>Порт (REST API)</label>
        <input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
        <label>Пользователь API</label>
        <input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <label>Пароль</label>
        <input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <label>Модель (опционально)</label>
        <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Отмена</button>
          <button className="primary" type="submit" disabled={busy}>{busy ? "Добавляем…" : "Добавить"}</button>
        </div>
      </form>
    </div>
  );
}

function ChangeMyPasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) return setError("Новый пароль и подтверждение не совпадают.");
    if (newPassword.length < 8) return setError("Новый пароль должен быть не короче 8 символов.");
    setBusy(true);
    try {
      await changeMyPassword(currentPassword, newPassword);
      setDone(true);
    } catch (err: any) {
      setError(err?.response?.data?.error === "Current password is incorrect" ? "Текущий пароль указан неверно." : "Не удалось сменить пароль.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Сменить пароль</h2>
        {done ? (
          <>
            <p className="muted">Пароль обновлён.</p>
            <div className="modal-actions">
              <button type="button" className="primary" onClick={onClose}>Готово</button>
            </div>
          </>
        ) : (
          <>
            <label>Текущий пароль</label>
            <input required type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            <label>Новый пароль</label>
            <input required type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <label>Повторите новый пароль</label>
            <input required type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {error && <div className="error-text">{error}</div>}
            <div className="modal-actions">
              <button type="button" onClick={onClose}>Отмена</button>
              <button className="primary" type="submit" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

function AddUserForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ username: "", password: "", role: "viewer" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createUser(form);
      setForm({ username: "", password: "", role: "viewer" });
      onCreated();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? "Не удалось добавить пользователя.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
      <div>
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Логин</label>
        <input required type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Пароль</label>
        <input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Роль</label>
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="viewer">viewer — только просмотр</option>
          <option value="operator">operator — просмотр + изменения</option>
          <option value="admin">admin — полный доступ</option>
        </select>
      </div>
      <button className="primary" type="submit" disabled={busy}>{busy ? "Добавляем…" : "+ Добавить"}</button>
      {error && <div className="error-text" style={{ width: "100%" }}>{error}</div>}
    </form>
  );
}

function UserRow({ user, onChanged }: { user: TenantUser; onChanged: () => void }) {
  const [role, setRole] = useState(user.role);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function saveRole() {
    setBusy(true);
    setMsg(null);
    try {
      await updateUser(user.id, { role });
      setMsg("Роль обновлена.");
      onChanged();
    } catch {
      setMsg("Не удалось обновить роль.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (newPassword.length < 8) return setMsg("Пароль должен быть не короче 8 символов.");
    setBusy(true);
    setMsg(null);
    try {
      await updateUser(user.id, { password: newPassword });
      setNewPassword("");
      setMsg("Пароль сброшен.");
    } catch {
      setMsg("Не удалось сбросить пароль.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Удалить пользователя ${user.username}?`)) return;
    setBusy(true);
    try {
      await deleteUser(user.id);
      onChanged();
    } catch {
      setMsg("Не удалось удалить (возможно, это ваш собственный аккаунт).");
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>{user.username}</td>
      <td>
        <select value={role} onChange={(e) => setRole(e.target.value as TenantUser["role"])} disabled={busy}>
          <option value="viewer">viewer</option>
          <option value="operator">operator</option>
          <option value="admin">admin</option>
        </select>
      </td>
      <td>
        <button onClick={saveRole} disabled={busy || role === user.role}>Сохранить роль</button>
      </td>
      <td>
        <div style={{ display: "flex", gap: 6 }}>
          <input type="password" placeholder="новый пароль" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={{ width: 130 }} />
          <button onClick={resetPassword} disabled={busy || !newPassword}>Сбросить</button>
        </div>
      </td>
      <td>
        <button onClick={remove} disabled={busy} style={{ borderColor: "var(--red)", color: "var(--red)" }}>Удалить</button>
      </td>
      <td className="muted" style={{ fontSize: 11 }}>{msg}</td>
    </tr>
  );
}

function UsersPanel({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<TenantUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setUsers(await listUsers());
    } catch {
      setError("Не удалось загрузить список пользователей.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 760 }}>
        <h2>Пользователи</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 16 }}>
          Пользователи видят те же роутеры и графики, что и вы — доступ ограничен только ролью (viewer — просмотр,
          operator — просмотр и изменения, admin — полный доступ, включая управление пользователями).
        </p>
        <AddUserForm onCreated={refresh} />
        {error && <div className="error-text">{error}</div>}
        {!users && !error && <p className="muted">Загрузка…</p>}
        {users && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Логин</th><th>Роль</th><th></th><th>Пароль</th><th></th><th></th></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <UserRow key={u.id} user={u} onChanged={refresh} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

function LogsPanel({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [service, setService] = useState("");
  const [level, setLevel] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function refresh() {
    try {
      setLogs(await getLogs({ service: service || undefined, level: level || undefined, limit: 300 }));
    } catch {
      setError("Не удалось загрузить логи.");
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, level]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, service, level]);

  function formatForCopy(): string {
    if (!logs) return "";
    return logs
      .map((l) => `[${new Date(l.created_at).toISOString()}] ${l.service}/${l.level}: ${l.message}${l.meta ? " " + JSON.stringify(l.meta) : ""}`)
      .join("\n");
  }

  async function copyAll() {
    setCopyError(null);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(formatForCopy());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API needs a secure context — silently unavailable on
      // plain http:// (this app is deliberately deployed that way, see
      // DEPLOY.md). Fall back to a file download instead of failing quietly.
      setCopyError("Буфер обмена недоступен (обычно из-за работы по HTTP без HTTPS) — используйте «Скачать .txt».");
    }
  }

  function downloadAll() {
    const blob = new Blob([formatForCopy()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mtkfleetman-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 860 }}>
        <h2>Логи</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -8, marginBottom: 14 }}>
          Ошибки и события бэкенда (api/worker) — в основном то, что происходит при опросе роутеров. Если что-то не
          работает, скачайте .txt и пришлите для разбора (копирование в буфер требует HTTPS — на обычном http:// не
          сработает, отсюда и кнопка «Скачать»).
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <select value={service} onChange={(e) => setService(e.target.value)}>
            <option value="">Все сервисы</option>
            <option value="api">api</option>
            <option value="worker">worker</option>
          </select>
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Все уровни</option>
            <option value="error">error</option>
            <option value="warn">warn</option>
            <option value="info">info</option>
          </select>
          <button onClick={refresh}>Обновить</button>
          <button onClick={() => setAutoRefresh((v) => !v)} style={autoRefresh ? { borderColor: "var(--blue)" } : undefined}>
            Автообновление: {autoRefresh ? "вкл" : "выкл"}
          </button>
          <button onClick={copyAll}>{copied ? "Скопировано!" : "Скопировать всё"}</button>
          <button className="primary" onClick={downloadAll}>Скачать .txt</button>
        </div>
        {copyError && <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 10 }}>{copyError}</p>}
        {error && <div className="error-text">{error}</div>}
        {!logs && !error && <p className="muted">Загрузка…</p>}
        {logs && !logs.length && <p className="muted">Логов пока нет.</p>}
        {logs && !!logs.length && (
          <div className="table-scroll" style={{ maxHeight: "50vh", overflowY: "auto" }}>
            <table>
              <thead>
                <tr><th>Время</th><th>Сервис</th><th>Уровень</th><th>Сообщение</th></tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="mono" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{new Date(l.created_at).toLocaleString()}</td>
                    <td>{l.service}</td>
                    <td>
                      <span className={`badge ${l.level === "error" ? "down" : l.level === "warn" ? "warn" : "unknown"}`}>{l.level}</span>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {l.message}
                      {!!l.meta && (
                        <div className="muted mono" style={{ fontSize: 10, marginTop: 2 }}>{JSON.stringify(l.meta)}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

function DocsPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 760 }}>
        <h2>Настройка роутера для этого приложения</h2>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <h3 style={{ fontSize: 14, marginTop: 0 }}>1. Включить REST API (обязательно)</h3>
          <pre className="mono" style={{ background: "var(--surface-2)", padding: 10, borderRadius: 8, fontSize: 12, overflowX: "auto" }}>
{`/ip service enable www-ssl
/ip service set www-ssl port=443 address=192.168.1.0/24`}
          </pre>
          <p className="muted">Ограничьте <code>address</code> подсетью, откуда реально стучится сервер с этим приложением.</p>

          <h3 style={{ fontSize: 14 }}>2. Сертификат для www-ssl (обязательно, без него TLS handshake не пройдёт)</h3>
          <pre className="mono" style={{ background: "var(--surface-2)", padding: 10, borderRadius: 8, fontSize: 12, overflowX: "auto" }}>
{`/certificate add name=local-ca common-name=local-ca key-usage=key-cert-sign,crl-sign
/certificate sign local-ca
/certificate add name=api-cert common-name=<IP роутера> key-usage=tls-server
/certificate sign api-cert ca=local-ca
/ip service set www-ssl certificate=api-cert`}
          </pre>

          <h3 style={{ fontSize: 14 }}>3. Отдельный пользователь для API (рекомендуется, не используйте admin)</h3>
          <pre className="mono" style={{ background: "var(--surface-2)", padding: 10, borderRadius: 8, fontSize: 12, overflowX: "auto" }}>
{`/user group add name=api-group policy=read,write,api,rest-api,ssh,test
/user add name=api-user group=api-group password=...`}
          </pre>
          <p className="muted">Логин/пароль этого пользователя используются и для REST API, и для терминала (SSH) в этом приложении — им нужен доступ <code>ssh</code>.</p>

          <h3 style={{ fontSize: 14 }}>4. SSH (для вкладки «Терминал»)</h3>
          <pre className="mono" style={{ background: "var(--surface-2)", padding: 10, borderRadius: 8, fontSize: 12, overflowX: "auto" }}>
{`/ip service enable ssh
/ip service set ssh port=22`}
          </pre>
          <p className="muted">Обычно включён по умолчанию. Терминал в приложении подключается на порт 22 тем же логином/паролем, что указан при добавлении роутера.</p>

          <h3 style={{ fontSize: 14 }}>5. Для «Топ Wi-Fi»</h3>
          <p>Работает и с CAPsMAN, и без него (локальный Wi-Fi роутера) — ничего дополнительно включать не нужно, кроме самого Wi-Fi/CAPsMAN.</p>

          <h3 style={{ fontSize: 14 }}>6. Для «Топ Ethernet»</h3>
          <p className="muted">Нужен настроенный бридж (<code>/interface bridge</code>) — иначе неоткуда взять таблицу MAC-адресов по портам. Neighbor Discovery включается отдельно на нужных интерфейсах, если хотите видеть соседние MikroTik/свитчи:</p>
          <pre className="mono" style={{ background: "var(--surface-2)", padding: 10, borderRadius: 8, fontSize: 12, overflowX: "auto" }}>
{`/ip neighbor discovery-settings set discover-interface-list=all`}
          </pre>

          <h3 style={{ fontSize: 14 }}>7. Для DHCP-статистики</h3>
          <p className="muted">Просто должен быть настроен DHCP-сервер (<code>/ip dhcp-server</code>) — данные читаются, ничего включать дополнительно не нужно. Заполненность пула на вкладке «DHCP» дополнительно читает <code>/ip pool</code> — тоже без отдельной настройки, если пул уже используется сервером.</p>

          <h3 style={{ fontSize: 14 }}>8. Для «Топ по блокировкам» (вкладка Firewall)</h3>
          <p className="muted">
            Без этого шага список останется пустым — приложение ничего не подставляет само, только читает системный
            лог. Включите <code>log=yes</code> на тех правилах firewall, чью статистику блокировок хотите видеть
            (обычно — drop/reject в конце цепочки <code>input</code>/<code>forward</code>):
          </p>
          <pre className="mono" style={{ background: "var(--surface-2)", padding: 10, borderRadius: 8, fontSize: 12, overflowX: "auto" }}>
{`/ip firewall filter set [find chain=input action=drop] log=yes log-prefix="drop-input"`}
          </pre>
          <p className="muted">
            Воркер опрашивает <code>/log</code> с фильтром по теме <code>firewall</code> и вытаскивает
            IP-адрес источника из строки лога — работает со стандартным форматом RouterOS
            (<code>src-ip:port-&gt;dst-ip:port</code> в тексте сообщения). Нестандартный <code>log-prefix</code> не
            мешает — просто не участвует в разборе.
          </p>

          <h3 style={{ fontSize: 14 }}>Частые проблемы</h3>
          <ul className="muted" style={{ paddingLeft: 18 }}>
            <li><code>Connection refused</code> на 443 — <code>www-ssl</code> выключен или порт другой</li>
            <li><code>TLS handshake failure</code> — не привязан сертификат к www-ssl (см. шаг 2)</li>
            <li><code>Session closed</code> при больших выгрузках (например, полная BGP-таблица) — сам RouterOS не справляется с сериализацией; в этом приложении такие запросы уже отфильтрованы/убраны</li>
            <li>Роутер периодически показывает <code>down</code>, хотя доступен — проверьте вкладку «Логи» (☰ меню, только admin), там видно, какой конкретно запрос не успевает</li>
          </ul>
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const [routers, setRouters] = useState<RouterSummary[]>([]);
  const [selected, setSelected] = useState<RouterSummary | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"fleet" | "map">("fleet");

  async function refresh() {
    try {
      const data = await listRouters();
      setRouters(data);
      setLoadError(null);
      if (selected) {
        const updated = data.find((r) => r.id === selected.id);
        if (updated) setSelected(updated);
      }
    } catch {
      // Surface this instead of failing silently — a stale/failed schema
      // (e.g. a missing migration) used to leave the list stuck on
      // "Загрузка…" forever with zero feedback, including right after a
      // router was actually added successfully.
      setLoadError("Не удалось загрузить список роутеров. Проверьте логи api (docker compose logs api) — часто это несделанная миграция БД.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    getMe().then(setMe).catch(() => {});
    // Poll fleet status regularly so the down-blink stays live.
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function logout() {
    localStorage.removeItem("token");
    window.location.reload();
  }

  return (
    <div className="app-shell" style={{ flexDirection: "column" }}>
      <div className="topbar">
        <h1>MikroTik Fleet Manager</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setViewMode("fleet")}
            style={viewMode === "fleet" ? { borderColor: "var(--blue)" } : undefined}
          >
            Список
          </button>
          <button
            onClick={() => setViewMode("map")}
            style={viewMode === "map" ? { borderColor: "var(--blue)" } : undefined}
          >
            Карта сети
          </button>
        <div style={{ position: "relative" }}>
          <button onClick={() => setMenuOpen((v) => !v)}>☰ Меню</button>
          {menuOpen && (
            <>
              <div
                onClick={() => setMenuOpen(false)}
                style={{ position: "fixed", inset: 0, zIndex: 9 }}
              />
              <div
                style={{
                  position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 10,
                  background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 10,
                  padding: 8, minWidth: 220, display: "flex", flexDirection: "column", gap: 4,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}
              >
                {me && (
                  <div className="muted" style={{ fontSize: 12, padding: "6px 10px" }}>
                    {me.username} · {me.role}
                  </div>
                )}
                <button style={{ textAlign: "left" }} onClick={() => { setShowAdd(true); setMenuOpen(false); }}>+ Добавить роутер</button>
                <button style={{ textAlign: "left" }} onClick={() => { setShowDocs(true); setMenuOpen(false); }}>Документация</button>
                <button style={{ textAlign: "left" }} onClick={() => { setShowPasswordModal(true); setMenuOpen(false); }}>Сменить пароль</button>
                {me?.role === "admin" && (
                  <button style={{ textAlign: "left" }} onClick={() => { setShowUsers(true); setMenuOpen(false); }}>Пользователи</button>
                )}
                {me?.role === "admin" && (
                  <button style={{ textAlign: "left" }} onClick={() => { setShowLogs(true); setMenuOpen(false); }}>Логи</button>
                )}
                <button style={{ textAlign: "left", borderColor: "var(--red)", color: "var(--red)" }} onClick={logout}>Выйти</button>
              </div>
            </>
          )}
        </div>
        </div>
      </div>
      <div className="main">
        {loading && <p className="muted">Загрузка…</p>}
        {loadError && <div className="error-text" style={{ marginBottom: 16 }}>{loadError}</div>}
        {!loading && !loadError && !routers.length && <p className="muted">Роутеров пока нет — добавьте первый.</p>}
        {viewMode === "map" && !loading && !!routers.length && (
          <NetworkMap routers={routers} onSelectRouter={setSelected} />
        )}
        {viewMode === "fleet" && (
        <div className="fleet-grid">
          {routers.map((r) => (
            <div
              key={r.id}
              className={`router-card ${selected?.id === r.id ? "active" : ""} ${r.monitoring_enabled && r.status === "down" ? "blink" : ""}`}
              onClick={() => setSelected(r)}
            >
              <div className="rname">{r.name}</div>
              <div className="rhost mono">{r.host}</div>
              <StatusBadge router={r} />
            </div>
          ))}
        </div>
        )}
        {selected && (
          <RouterDetail
            router={selected}
            onDeleted={() => {
              setSelected(null);
              refresh();
            }}
            onUpdated={refresh}
          />
        )}
      </div>
      {showAdd && <AddRouterModal onClose={() => setShowAdd(false)} onCreated={refresh} />}
      {showPasswordModal && <ChangeMyPasswordModal onClose={() => setShowPasswordModal(false)} />}
      {showUsers && <UsersPanel onClose={() => setShowUsers(false)} />}
      {showLogs && <LogsPanel onClose={() => setShowLogs(false)} />}
      {showDocs && <DocsPanel onClose={() => setShowDocs(false)} />}
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(!!localStorage.getItem("token"));
  if (!authed) return <LoginScreen onLoggedIn={() => setAuthed(true)} />;
  return <Dashboard />;
}
