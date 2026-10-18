
const $ = id => document.getElementById(id);

let mode = "login";
let currentUser = null;
let expenses = [];
let incomes = [];
let budgetInfo = { budget: 0, spent: 0, remaining: 0 };

const defaultSettings = {
    theme: "system",
    accent: "#625bf6",
    compact: false,
    language: "en",
    currency: "INR",
    dateFormat: "local"
};

let settings = { ...defaultSettings };

const translations = {
    en: {
        dashboard: "Finance Dashboard",
        manage: "Manage your money in one place",
        overview: "Financial Overview 👋",
        overviewSub: "Your income, expenses and monthly budget.",
        income: "Total Income",
        expense: "Total Expenses",
        balance: "Available Balance",
        monthly: "This Month's Spending",
        allIncome: "All recorded income",
        allExpenses: "All recorded expenses",
        currentMonth: "Current calendar month",
        addIncome: "＋ Add Income",
        addExpense: "＋ Add Expense",
        budget: "Monthly Budget",
        chart: "Expense Chart",
        transactions: "Transactions",
        settings: "Settings ⚙",
        settingsSub: "Customize your Finora experience and account preferences.",
        export: "Export CSV",
        logout: "Logout",
        theme: "Theme",
        language: "Language",
        currency: "Currency",
        date: "Date"
    },
    bn: {
        dashboard: "ফাইন্যান্স ড্যাশবোর্ড",
        manage: "এক জায়গায় আপনার অর্থ পরিচালনা করুন",
        overview: "আর্থিক সারসংক্ষেপ 👋",
        overviewSub: "আপনার আয়, খরচ ও মাসিক বাজেট।",
        income: "মোট আয়",
        expense: "মোট খরচ",
        balance: "অবশিষ্ট ব্যালেন্স",
        monthly: "এই মাসের খরচ",
        allIncome: "নথিভুক্ত মোট আয়",
        allExpenses: "নথিভুক্ত মোট খরচ",
        currentMonth: "চলতি ক্যালেন্ডার মাস",
        addIncome: "＋ আয় যোগ করুন",
        addExpense: "＋ খরচ যোগ করুন",
        budget: "মাসিক বাজেট",
        chart: "খরচের চার্ট",
        transactions: "লেনদেন",
        settings: "সেটিংস ⚙",
        settingsSub: "Finora-র অভিজ্ঞতা কাস্টমাইজ করুন।",
        export: "CSV এক্সপোর্ট",
        logout: "লগআউট",
        theme: "থিম",
        language: "ভাষা",
        currency: "মুদ্রা",
        date: "তারিখ"
    }
};

function t(key) {
    return (translations[settings.language] || translations.en)[key]
        || translations.en[key]
        || key;
}

function readSettings() {
    try {
        settings = {
            ...defaultSettings,
            ...JSON.parse(localStorage.getItem("finoraSettings") || "{}")
        };
    } catch {
        settings = { ...defaultSettings };
    }

    applySettings();
}

function saveSettings() {
    try {
        localStorage.setItem("finoraSettings", JSON.stringify(settings));
        return true;
    } catch {
        return false;
    }
}

function applySettings() {
    const theme = settings.theme === "system"
        ? (window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light")
        : settings.theme;

    document.body.dataset.theme = theme;

    document.documentElement.style.setProperty(
        "--primary",
        settings.accent || defaultSettings.accent
    );

    document.body.classList.toggle("compact", !!settings.compact);
    document.documentElement.lang = settings.language === "bn" ? "bn" : "en";

    if ($("themeSetting")) $("themeSetting").value = settings.theme;
    if ($("accentSetting")) $("accentSetting").value = settings.accent;
    if ($("compactSetting")) $("compactSetting").checked = !!settings.compact;
    if ($("languageSetting")) $("languageSetting").value = settings.language;
    if ($("currencySetting")) $("currencySetting").value = settings.currency;
    if ($("dateFormatSetting")) $("dateFormatSetting").value = settings.dateFormat;

    translateStaticLabels();
    updateSummary();
    renderChart();
    renderTransactions();
}

function translateStaticLabels() {
    if (!$("headerTitle")) return;

    $("headerTitle").textContent = t("dashboard");

    if (!currentUser) {
        $("hello").textContent = t("manage");
    }

    $("exportBtn").textContent = t("export");
    $("logoutBtn").textContent = t("logout");

    const navLabels = [
        ['[data-target="overview"]', settings.language === "bn" ? "◫ সারসংক্ষেপ" : "◫ Overview"],
        ['[data-target="incomePanel"]', t("addIncome")],
        ['[data-target="expensePanel"]', t("addExpense")],
        ['[data-target="budgetPage"]', "▦ " + t("budget")],
        ['[data-target="chartPage"]', "▥ " + t("chart")],
        ['[data-target="transactionsPage"]', "▤ " + t("transactions")],
        ['[data-target="settingsPage"]', t("settings")]
    ];

    navLabels.forEach(([selector, label]) => {
        const element = document.querySelector(selector);
        if (element) element.textContent = label;
    });

    const overview = $("overview");

    if (overview) {
        const heading = overview.querySelector(".welcome h2");
        const subtitle = overview.querySelector(".welcome .muted");

        if (heading) heading.textContent = t("overview");
        if (subtitle) subtitle.textContent = t("overviewSub");

        const labels = overview.querySelectorAll(".stats .stat-label");
        const notes = overview.querySelectorAll(".stats .stat-note");

        [t("income"), t("expense"), t("balance"), t("monthly")]
            .forEach((value, index) => {
                if (labels[index]) labels[index].textContent = value;
            });

        [
            t("allIncome"),
            t("allExpenses"),
            "Income minus expenses",
            t("currentMonth")
        ].forEach((value, index) => {
            if (notes[index]) notes[index].textContent = value;
        });
    }

    const settingsPage = $("settingsPage");

    if (settingsPage) {
        const heading = settingsPage.querySelector(".welcome h2");
        const subtitle = settingsPage.querySelector(".welcome .muted");

        if (heading) heading.textContent = t("settings");
        if (subtitle) subtitle.textContent = t("settingsSub");
    }
}

function money(amount) {
    try {
        return new Intl.NumberFormat(
            settings.language === "bn" ? "bn-BD" : "en-IN",
            {
                style: "currency",
                currency: settings.currency || "INR",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }
        ).format(Number(amount || 0));
    } catch {
        return "₹" + Number(amount || 0).toFixed(2);
    }
}

function localDate(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function currentMonth() {
    return localDate().slice(0, 7);
}

function formatDate(date) {
    if (!date || date === "—") return "—";
    if (settings.dateFormat === "iso") return date;

    const parts = date.split("-");

    if (parts.length !== 3) return date;

    if (settings.dateFormat === "dmy") {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    if (settings.dateFormat === "mdy") {
        return `${parts[1]}/${parts[2]}/${parts[0]}`;
    }

    return new Date(date + "T12:00:00").toLocaleDateString(
        settings.language === "bn" ? "bn-BD" : "en-IN",
        { day: "numeric", month: "short", year: "numeric" }
    );
}

function setAuthMode(nextMode) {
    mode = nextMode;

    $("loginTab").classList.toggle("active", mode === "login");
    $("registerTab").classList.toggle("active", mode === "register");
    $("nameField").classList.toggle("hidden", mode !== "register");
    $("authName").required = mode === "register";
    $("authPassword").autocomplete =
        mode === "login" ? "current-password" : "new-password";

    $("authSubmit").textContent =
        mode === "login" ? "Login" : "Create Account";

    $("authMessage").textContent = "";
}

$("loginTab").addEventListener("click", () => setAuthMode("login"));
$("registerTab").addEventListener("click", () => setAuthMode("register"));

async function api(url, options = {}) {
    // console.log(url)
    
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        }
    });

    if (!response.ok) {
        let message = "Request failed.";

        try {
            const data = await response.json();
            message = data.error || message;
        } catch { }

        if (response.status === 401 && !url.startsWith("/api/auth/")) {
            showAuth();
        }

        throw new Error(message);
    }

    if (response.status === 204) return {};

    return response.json();
}

function showAuth() {
    $("authScreen").classList.remove("hidden");
    $("app").classList.add("hidden");
    currentUser = null;
}

function showApp(user) {
    currentUser = user;

    $("authScreen").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("hello").textContent = `Welcome, ${user.name}`;
    $("avatar").textContent = (user.name || "U").slice(0, 1).toUpperCase();

    populateProfile();
    loadAll();
}

function populateProfile() {
    if (!currentUser) return;

    $("profileName").value = currentUser.name || "";
    $("profileEmail").value = currentUser.email || "";
    $("sessionName").textContent = currentUser.name || "Signed in";
    $("sessionEmail").textContent = currentUser.email || "—";
    $("sessionStatus").textContent = "Active";
}

$("authForm").addEventListener("submit", async event => {
    event.preventDefault();

    const button = $("authSubmit");
    button.disabled = true;
    $("authMessage").textContent = "";

    const payload = {
        email: $("authEmail").value.trim(),
        password: $("authPassword").value
    };

    if (mode === "register") {
        payload.name = $("authName").value.trim();
    }

    try {
        const result = await api(`/api/auth/${mode}`, {
            method: "POST",
            body: JSON.stringify(payload)
        });

        $("authPassword").value = "";
        showApp(result.user);
    } catch (error) {
        $("authMessage").textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

async function logout() {
    try {
        await api("/api/auth/logout", { method: "POST" });
    } catch { }

    setAuthMode("login");
    showAuth();
}

$("logoutBtn").addEventListener("click", logout);
$("securityLogoutBtn").addEventListener("click", logout);
$("sessionLogoutBtn").addEventListener("click", logout);

async function loadBudget() {
    const month = $("budgetMonth").value || currentMonth();

    try {
        budgetInfo = await api("/api/budget/" + encodeURIComponent(month));

        $("budgetAmount").value = budgetInfo.budget || "";
        $("budgetSpent").textContent =
            (settings.language === "bn" ? "খরচ: " : "Spent: ") +
            money(budgetInfo.spent);

        $("budgetRemaining").textContent =
            (settings.language === "bn" ? "অবশিষ্ট: " : "Remaining: ") +
            money(budgetInfo.remaining);

        const percentage = budgetInfo.budget > 0
            ? budgetInfo.spent / budgetInfo.budget * 100
            : 0;

        $("budgetBar").style.width = Math.min(percentage, 100) + "%";
        $("budgetBar").classList.toggle("over", percentage > 100);
    } catch (error) {
        $("budgetMessage").textContent = error.message;
    }
}

function updateSummary() {
    if (!$("totalIncome")) return;

    const totalIncome = incomes.reduce(
        (sum, item) => sum + Number(item.amount || 0), 0
    );

    const totalExpense = expenses.reduce(
        (sum, item) => sum + Number(item.amount || 0), 0
    );

    const now = new Date();

    const monthly = expenses.reduce((sum, item) => {
        if (!item.date) return sum;

        const date = new Date(item.date + "T12:00:00");

        return date.getMonth() === now.getMonth() &&
            date.getFullYear() === now.getFullYear()
            ? sum + Number(item.amount || 0)
            : sum;
    }, 0);

    $("totalIncome").textContent = money(totalIncome);
    $("totalExpense").textContent = money(totalExpense);
    $("balance").textContent = money(totalIncome - totalExpense);

    $("balance").className =
        "stat-value " + (totalIncome - totalExpense < 0
            ? "red-text"
            : "purple-text");

    $("monthlyExpense").textContent = money(monthly);

    if ($("chartTotal")) {
        $("chartTotal").textContent = money(totalExpense);
    }
}

function renderChart() {
    if (!$("chart")) return;

    const totals = {};

    expenses.forEach(item => {
        const category = item.category || "Other";
        totals[category] = (totals[category] || 0) + Number(item.amount || 0);
    });

    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);

    $("chart").replaceChildren();
    $("chartEmpty").hidden = entries.length > 0;

    const max = Math.max(1, ...entries.map(item => item[1]));

    entries.forEach(([category, amount]) => {
        const row = document.createElement("div");
        row.className = "chart-row";

        const name = document.createElement("div");
        name.className = "chart-name";
        name.textContent = category;

        const track = document.createElement("div");
        track.className = "track";

        const bar = document.createElement("div");
        bar.className = "bar";
        bar.style.width = amount / max * 100 + "%";

        track.appendChild(bar);

        const value = document.createElement("div");
        value.className = "chart-amount";
        value.textContent = money(amount);

        row.append(name, track, value);
        $("chart").appendChild(row);
    });
}

function allTransactions() {
    return [
        ...expenses.map(item => ({ ...item, type: "Expense" })),
        ...incomes.map(item => ({ ...item, type: "Income" }))
    ].sort((a, b) =>
        String(b.date || "").localeCompare(String(a.date || "")) ||
        Number(b.id || 0) - Number(a.id || 0)
    );
}

function renderTransactions() {
    if (!$("transactionsList")) return;

    const query = $("search").value.trim().toLowerCase();
    const category = $("filter").value;

    const rows = allTransactions().filter(item =>
        (
            String(item.title || "").toLowerCase().includes(query) ||
            String(item.category || "").toLowerCase().includes(query)
        ) &&
        (category === "All" || item.category === category)
    );

    const tbody = $("transactionsList");
    tbody.replaceChildren();
    $("transactionsEmpty").hidden = rows.length > 0;

    rows.forEach(item => {
        const tr = document.createElement("tr");

        function cell(text, className = "") {
            const td = document.createElement("td");
            td.textContent = text;
            if (className) td.className = className;
            return td;
        }

        tr.appendChild(cell(item.title || ""));
        tr.appendChild(cell(
            item.type,
            item.type === "Income" ? "green-text" : "red-text"
        ));

        const categoryCell = document.createElement("td");
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = item.category || "Other";
        categoryCell.appendChild(tag);
        tr.appendChild(categoryCell);

        tr.appendChild(cell(formatDate(item.date)));

        tr.appendChild(cell(
            (item.type === "Income" ? "+" : "−") + money(item.amount),
            item.type === "Income" ? "green-text" : "red-text"
        ));

        const actionCell = document.createElement("td");
        const button = document.createElement("button");

        button.className = "delete";
        button.textContent = "Delete";
        button.type = "button";

        button.addEventListener("click", async () => {
            if (!confirm(`Delete this ${item.type.toLowerCase()}?`)) return;

            try {
                const endpoint = item.type === "Income"
                    ? "/api/income/"
                    : "/api/expenses/";

                await api(endpoint + encodeURIComponent(item.id), {
                    method: "DELETE"
                });

                await loadAll();
            } catch (error) {
                alert(error.message);
            }
        });

        actionCell.appendChild(button);
        tr.appendChild(actionCell);
        tbody.appendChild(tr);
    });
}

async function loadAll() {
    try {
        const [expenseData, incomeData] = await Promise.all([
            api("/api/expenses"),
            api("/api/income")
        ]);

        expenses = Array.isArray(expenseData) ? expenseData : [];
        incomes = Array.isArray(incomeData) ? incomeData : [];

        updateSummary();
        renderChart();
        renderTransactions();

        await loadBudget();
    } catch (error) {
        console.error("Could not load transactions:", error);
    }
}

function setupTransactionForm(config) {
    $(config.form).addEventListener("submit", async event => {
        event.preventDefault();

        const message = $(config.message);
        message.textContent = "";

        const payload = {
            title: $(config.title).value.trim(),
            amount: Number($(config.amount).value),
            category: $(config.category).value,
            date: $(config.date).value
        };

        if (
            !payload.title ||
            !Number.isFinite(payload.amount) ||
            payload.amount <= 0 ||
            !payload.date
        ) {
            message.textContent = "Enter a valid name, amount and date.";
            return;
        }

        const button = $(config.button);
        button.disabled = true;

        try {
            await api(config.endpoint, {
                method: "POST",
                body: JSON.stringify(payload)
            });

            $(config.form).reset();
            $(config.date).value = localDate();

            await loadAll();

            message.className = "message success";
            message.textContent = "Saved successfully!";
        } catch (error) {
            message.className = "message";
            message.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });
}

setupTransactionForm({
    form: "incomeForm",
    title: "incomeTitle",
    amount: "incomeAmount",
    category: "incomeCategory",
    date: "incomeDate",
    button: "incomeSubmit",
    message: "incomeMessage",
    endpoint: "/api/income"
});

setupTransactionForm({
    form: "expenseForm",
    title: "expenseTitle",
    amount: "expenseAmount",
    category: "expenseCategory",
    date: "expenseDate",
    button: "expenseSubmit",
    message: "expenseMessage",
    endpoint: "/api/expenses"
});

$("budgetMonth").addEventListener("change", loadBudget);

$("budgetForm").addEventListener("submit", async event => {
    event.preventDefault();

    const month = $("budgetMonth").value;
    const amount = Number($("budgetAmount").value);

    $("budgetMessage").textContent = "";

    if (!month || !Number.isFinite(amount) || amount < 0) {
        $("budgetMessage").textContent = "Enter a valid month and budget.";
        return;
    }

    const button = $("budgetSubmit");
    button.disabled = true;

    try {
        await api("/api/budget/" + encodeURIComponent(month), {
            method: "PUT",
            body: JSON.stringify({ amount })
        });

        await loadBudget();

        $("budgetMessage").className = "message success";
        $("budgetMessage").textContent = "Budget saved successfully!";
    } catch (error) {
        $("budgetMessage").className = "message";
        $("budgetMessage").textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

$("search").addEventListener("input", renderTransactions);
$("filter").addEventListener("change", renderTransactions);

function exportCsv() {
    window.location.href = "/api/export.csv";
}

$("exportBtn").addEventListener("click", exportCsv);
$("settingsExportBtn").addEventListener("click", exportCsv);

document.querySelectorAll(".nav[data-target]").forEach(button => {
    button.addEventListener("click", () => {
        const target = button.dataset.target;

        const pageId =
            target === "incomePanel" || target === "expensePanel"
                ? "overview"
                : target;

        document.querySelectorAll(".page").forEach(page => {
            page.classList.toggle("active", page.id === pageId);
        });

        document.querySelectorAll(".nav").forEach(nav => {
            nav.classList.toggle("active", nav === button);
        });

        const destination = document.getElementById(
            target === "incomePanel" || target === "expensePanel"
                ? target
                : pageId
        );

        if (destination) {
            destination.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        }

        const titleMap = {
            overview: t("dashboard"),
            budgetPage: t("budget"),
            chartPage: t("chart"),
            transactionsPage: t("transactions"),
            settingsPage: t("settings"),
            incomePanel: t("addIncome"),
            expensePanel: t("addExpense")
        };

        $("headerTitle").textContent = titleMap[target] || t("dashboard");
    });
});

[
    "themeSetting",
    "accentSetting",
    "compactSetting",
    "languageSetting",
    "currencySetting",
    "dateFormatSetting"
].forEach(id => {
    $(id).addEventListener("change", () => {
        settings.theme = $("themeSetting").value;
        settings.accent = $("accentSetting").value;
        settings.compact = $("compactSetting").checked;
        settings.language = $("languageSetting").value;
        settings.currency = $("currencySetting").value;
        settings.dateFormat = $("dateFormatSetting").value;

        applySettings();

        $("today").textContent = formatDate(localDate());

        $("settingsMessage").className = "settings-status";
        $("settingsMessage").textContent =
            "Preview updated. Click Save to keep these settings.";
    });
});

$("saveSettingsBtn").addEventListener("click", () => {
    settings.theme = $("themeSetting").value;
    settings.accent = $("accentSetting").value;
    settings.compact = $("compactSetting").checked;
    settings.language = $("languageSetting").value;
    settings.currency = $("currencySetting").value;
    settings.dateFormat = $("dateFormatSetting").value;

    applySettings();

    const saved = saveSettings();

    $("settingsMessage").className =
        "settings-status " + (saved ? "success" : "");

    $("settingsMessage").textContent = saved
        ? "Settings saved in this browser."
        : "Could not save settings in this browser.";
});

$("profileForm").addEventListener("submit", async event => {
    event.preventDefault();

    const message = $("profileMessage");
    const button = $("profileSaveBtn");
    message.textContent = "";

    const name = $("profileName").value.trim();

    if (!name) {
        message.textContent = "Name is required.";
        return;
    }

    button.disabled = true;

    try {
        const result = await api("/api/auth/profile", {
            method: "PUT",
            body: JSON.stringify({ name })
        });

        currentUser = result.user || { ...currentUser, name };

        populateProfile();

        $("hello").textContent = `Welcome, ${currentUser.name}`;
        $("avatar").textContent = currentUser.name.slice(0, 1).toUpperCase();

        message.className = "settings-status success";
        message.textContent = "Profile updated successfully.";
    } catch (error) {
        message.className = "settings-status";
        message.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

$("passwordForm").addEventListener("submit", async event => {
    event.preventDefault();

    const message = $("passwordMessage");
    const button = $("passwordSaveBtn");

    const currentPassword = $("currentPassword").value;
    const newPassword = $("newPassword").value;
    const confirmPassword = $("confirmPassword").value;

    message.className = "settings-status";
    message.textContent = "";

    if (newPassword.length < 8) {
        message.textContent = "New password must be at least 8 characters.";
        return;
    }

    if (newPassword !== confirmPassword) {
        message.textContent = "New passwords do not match.";
        return;
    }

    if (currentPassword === newPassword) {
        message.textContent = "Choose a different new password.";
        return;
    }

    button.disabled = true;

    try {
        await api("/api/auth/change-password", {
            method: "POST",
            body: JSON.stringify({ currentPassword, newPassword })
        });

        $("passwordForm").reset();

        message.className = "settings-status success";
        message.textContent = "Password changed successfully.";
    } catch (error) {
        message.textContent = error.message;
    } finally {
        button.disabled = false;
    }
});

function initializeDates() {
    if ($("today")) $("today").textContent = formatDate(localDate());
    if ($("incomeDate")) $("incomeDate").value = localDate();
    if ($("expenseDate")) $("expenseDate").value = localDate();
    if ($("budgetMonth")) $("budgetMonth").value = currentMonth();
}

readSettings();
initializeDates();

if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)")
        .addEventListener?.("change", () => {
            if (settings.theme === "system") applySettings();
        });
}

(async function start() {
    try {
        const result = await api("/api/auth/me");
        showApp(result.user);
    } catch {
        showAuth();
    }
})();
