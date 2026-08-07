import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Scope, deliberately: app chrome only (login, top menu, tabs, fleet list,
// status words) — not every string in every tab/modal. Those still render
// in Russian regardless of the selected language; expand this dictionary
// on request rather than translating the whole app in one pass.
const resources = {
  ru: {
    translation: {
      login: {
        subtitle: "Войдите, чтобы увидеть парк роутеров",
        username: "логин",
        password: "пароль",
        submit: "Войти",
        submitting: "Входим…",
        error: "Неверный логин или пароль.",
      },
      topbar: { list: "Список", map: "Карта сети", menu: "☰ Меню" },
      menu: {
        addRouter: "+ Добавить роутер",
        docs: "Документация",
        changePassword: "Сменить пароль",
        users: "Пользователи",
        logs: "Логи",
        logout: "Выйти",
        language: "Язык",
      },
      tabs: {
        mon: "Мониторинг",
        wifiTop: "Топ Wi-Fi",
        ethTop: "Топ Ethernet",
        fw: "Firewall",
        dhcp: "DHCP",
        wifi: "Wi-Fi",
        dest: "Топ адресов назначения",
        term: "Терминал",
        topo: "Схема сети",
        cfg: "Настройки",
      },
      fleet: {
        loading: "Загрузка…",
        empty: "Роутеров пока нет — добавьте первый.",
        loadError:
          "Не удалось загрузить список роутеров. Проверьте логи api (docker compose logs api) — часто это несделанная миграция БД.",
      },
      status: {
        up: "работает",
        warn: "предупреждение",
        down: "недоступен",
        unknown: "неизвестно",
        monitoringOff: "мониторинг выкл",
      },
    },
  },
  en: {
    translation: {
      login: {
        subtitle: "Sign in to see your router fleet",
        username: "username",
        password: "password",
        submit: "Sign in",
        submitting: "Signing in…",
        error: "Invalid username or password.",
      },
      topbar: { list: "List", map: "Network map", menu: "☰ Menu" },
      menu: {
        addRouter: "+ Add router",
        docs: "Documentation",
        changePassword: "Change password",
        users: "Users",
        logs: "Logs",
        logout: "Log out",
        language: "Language",
      },
      tabs: {
        mon: "Monitoring",
        wifiTop: "Top Wi-Fi",
        ethTop: "Top Ethernet",
        fw: "Firewall",
        dhcp: "DHCP",
        wifi: "Wi-Fi",
        dest: "Top destinations",
        term: "Terminal",
        topo: "Network map",
        cfg: "Settings",
      },
      fleet: {
        loading: "Loading…",
        empty: "No routers yet — add the first one.",
        loadError:
          "Failed to load the router list. Check the api logs (docker compose logs api) — often a missing DB migration.",
      },
      status: {
        up: "up",
        warn: "warning",
        down: "down",
        unknown: "unknown",
        monitoringOff: "monitoring off",
      },
    },
  },
  zh: {
    translation: {
      login: {
        subtitle: "登录以查看路由器列表",
        username: "用户名",
        password: "密码",
        submit: "登录",
        submitting: "登录中…",
        error: "用户名或密码错误。",
      },
      topbar: { list: "列表", map: "网络拓扑图", menu: "☰ 菜单" },
      menu: {
        addRouter: "+ 添加路由器",
        docs: "文档",
        changePassword: "修改密码",
        users: "用户管理",
        logs: "日志",
        logout: "退出登录",
        language: "语言",
      },
      tabs: {
        mon: "监控",
        wifiTop: "Wi-Fi 排行",
        ethTop: "以太网排行",
        fw: "防火墙",
        dhcp: "DHCP",
        wifi: "Wi-Fi",
        dest: "目的地址排行",
        term: "终端",
        topo: "网络拓扑图",
        cfg: "设置",
      },
      fleet: {
        loading: "加载中…",
        empty: "还没有路由器 — 添加第一台。",
        loadError: "无法加载路由器列表。请检查 api 日志（docker compose logs api）— 通常是数据库迁移未执行。",
      },
      status: {
        up: "正常",
        warn: "警告",
        down: "离线",
        unknown: "未知",
        monitoringOff: "监控已暂停",
      },
    },
  },
};

const STORAGE_KEY = "language";

i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem(STORAGE_KEY) ?? "ru",
  fallbackLng: "ru",
  interpolation: { escapeValue: false },
});

export function setLanguage(lng: "ru" | "en" | "zh") {
  i18n.changeLanguage(lng);
  localStorage.setItem(STORAGE_KEY, lng);
}

export default i18n;
