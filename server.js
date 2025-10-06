const express = require('express');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');

const DATA_DIR = path.join(__dirname, 'data');
const TRANSLATIONS_DIR = path.join(__dirname, 'translations');
const WHATSAPP_LOG = path.join(DATA_DIR, 'whatsapp-log.json');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(methodOverride('_method'));

app.use(
  session({
    secret: 'junglepark-secret-key',
    resave: false,
    saveUninitialized: false
  })
);

const SUPPORTED_LANGS = ['ru', 'kk'];
const translations = {};

async function loadTranslations() {
  for (const lang of SUPPORTED_LANGS) {
    const file = path.join(TRANSLATIONS_DIR, `${lang}.json`);
    translations[lang] = await fs.readJSON(file);
  }
}

async function ensureDataFiles() {
  await fs.ensureDir(DATA_DIR);
  const defaults = {
    'users.json': [],
    'menu.json': [],
    'programs.json': [],
    'settings.json': {
      ownerAuthorized: false,
      cafeNumber: '+7 705 561 9337',
      cashierNumber: '+7 705 123 4567',
      maintenance: false
    },
    'whatsapp-log.json': []
  };

  for (const [file, value] of Object.entries(defaults)) {
    const fullPath = path.join(DATA_DIR, file);
    const exists = await fs.pathExists(fullPath);
    if (!exists) {
      await fs.writeJSON(fullPath, value, { spaces: 2 });
    }
  }
}

async function readData(file) {
  const filePath = path.join(DATA_DIR, file);
  return fs.readJSON(filePath);
}

async function writeData(file, data) {
  const filePath = path.join(DATA_DIR, file);
  await fs.writeJSON(filePath, data, { spaces: 2 });
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'KZT',
    maximumFractionDigits: 0
  }).format(amount);
}

function mapMenuForLang(items, lang) {
  return items
    .filter((item) => item.available)
    .map((item) => ({
      ...item,
      title: item.title?.[lang] || item.title?.ru || '',
      description: item.description?.[lang] || item.description?.ru || '',
      formattedPrice: formatCurrency(item.price)
    }));
}

function mapProgramsForLang(items, lang) {
  return items.map((item) => ({
    ...item,
    title: item.title?.[lang] || item.title?.ru || '',
    description: item.description?.[lang] || item.description?.ru || '',
    formattedPrice: formatCurrency(item.price)
  }));
}

function formatPhone(number) {
  if (!number) return '+7 705 561 9337';
  const digits = number.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('7')) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 11)}`;
  }
  if (digits.length === 12 && digits.startsWith('77')) {
    return `+${digits.slice(0, 1)} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 12)}`;
  }
  return number;
}

async function appendWhatsappLog(entry) {
  const log = await readData('whatsapp-log.json');
  log.push({ ...entry, date: new Date().toISOString() });
  await writeData('whatsapp-log.json', log);
}

function getUserFromSession(req) {
  if (!req.session.userId) return null;
  return req.session.user;
}

const ROLES = {
  ADMIN: 'Administrator',
  BARMEN: 'Bartender',
  CASHIER: 'Cashier'
};

function requireAuth(req, res, next) {
  const user = getUserFromSession(req);
  if (!user) {
    return res.redirect(`/admin/login?lang=${res.locals.lang}`);
  }
  req.user = user;
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
    const user = getUserFromSession(req);
    if (!user || !roles.includes(user.role)) {
      return res.status(403).render('errors/403', {
        t: res.locals.t,
        lang: res.locals.lang,
        user,
        contactNumber: res.locals.contactNumber
      });
    }
    req.user = user;
    next();
  };
}

app.use(async (req, res, next) => {
  if (!translations.ru) {
    await loadTranslations();
  }
  if (!(await fs.pathExists(WHATSAPP_LOG))) {
    await ensureDataFiles();
  }

  let lang = req.query.lang || req.cookies.lang || 'ru';
  if (!SUPPORTED_LANGS.includes(lang)) {
    lang = 'ru';
  }
  res.locals.lang = lang;
  res.locals.t = (key) => translations[lang][key] || key;
  res.locals.translations = translations[lang];
  res.locals.siteName = translations[lang].siteName;

  if (req.query.lang) {
    res.cookie('lang', lang, { maxAge: 1000 * 60 * 60 * 24 * 365 });
  }

  const settings = await readData('settings.json');
  res.locals.settings = settings;
  const digits = (settings.cafeNumber || '').replace(/\D/g, '');
  res.locals.contactNumber = formatPhone(settings.cafeNumber || '+77055619337');
  res.locals.whatsAppLink = digits ? `https://wa.me/${digits}` : 'https://wa.me/77055619337';

  const user = getUserFromSession(req);
  res.locals.currentUser = user;
  res.locals.currentPath = req.path;
  res.locals.requestPath = req.path;

  const isAdminRoute = req.path.startsWith('/admin');
  if (settings.maintenance && !isAdminRoute) {
    return res.render('maintenance', {
      t: res.locals.t,
      lang,
      contactNumber: res.locals.contactNumber
    });
  }

  next();
});

async function ensureRootUser() {
  const users = await readData('users.json');
  const existingRoot = users.find((u) => u.username === 'root');
  if (!existingRoot) {
    const passwordHash = await bcrypt.hash('rootK', 10);
    users.push({
      id: uuidv4(),
      username: 'root',
      passwordHash,
      role: ROLES.ADMIN,
      mustChangePassword: true
    });
    await writeData('users.json', users);
  }
}

app.use(async (req, res, next) => {
  await ensureRootUser();
  next();
});

app.get('/', async (req, res) => {
  const lang = res.locals.lang;
  const menu = mapMenuForLang(await readData('menu.json'), lang).slice(0, 3);
  const programs = mapProgramsForLang(await readData('programs.json'), lang).filter((p) => p.available).slice(0, 3);
  res.render('home', {
    menu,
    programs,
    lang,
    t: res.locals.t
  });
});

app.get('/menu', async (req, res) => {
  const lang = res.locals.lang;
  const menuItems = mapMenuForLang(await readData('menu.json'), lang);
  res.render('menu', {
    items: menuItems,
    lang,
    t: res.locals.t
  });
});

app.get('/programs', async (req, res) => {
  const lang = res.locals.lang;
  const programs = mapProgramsForLang(await readData('programs.json'), lang).filter((p) => p.available);
  res.render('programs', {
    programs,
    lang,
    t: res.locals.t
  });
});

app.post('/api/order', async (req, res) => {
  try {
    const { items, total, address, phone } = req.body;
    const settings = await readData('settings.json');
    if (!settings.ownerAuthorized) {
      return res.status(400).json({ message: res.locals.t('ownerNotAuthorized') });
    }
    if (!items?.length) {
      return res.status(400).json({ message: res.locals.t('totalEmpty') });
    }
    if (!address || !phone) {
      return res.status(400).json({ message: res.locals.t('error') });
    }
    const message = `📦 Новый заказ из кафе Jungle Park:\nПозиции: ${items.join(', ')}\nОбщая сумма: ${total}\nАдрес: ${address}\nТелефон клиента: ${phone}`;
    await appendWhatsappLog({
      type: 'order',
      to: settings.cafeNumber,
      message,
      payload: { items, total, address, phone }
    });
    return res.json({ message: res.locals.t('orderSuccess') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: res.locals.t('error') });
  }
});

app.post('/api/program-request', async (req, res) => {
  try {
    const { programId, childName, date, phone, name } = req.body;
    const programs = await readData('programs.json');
    const program = programs.find((p) => p.id === programId);
    if (!program) {
      return res.status(404).json({ message: res.locals.t('error') });
    }
    const settings = await readData('settings.json');
    if (!settings.ownerAuthorized) {
      return res.status(400).json({ message: res.locals.t('ownerNotAuthorized') });
    }
    if (!childName || !date || !phone || !name) {
      return res.status(400).json({ message: res.locals.t('error') });
    }
    const lang = res.locals.lang;
    const programTitle = program.title?.[lang] || program.title?.ru || '';
    const message = `🎉 Новая заявка на программу Jungle Park:\nПрограмма: ${programTitle}\nИмя ребёнка: ${childName}\nДата: ${date}\nКонтакт: ${phone}\nИмя взрослого: ${name}`;
    await appendWhatsappLog({
      type: 'program',
      to: settings.cashierNumber,
      message,
      payload: { programId, childName, date, phone, name }
    });
    return res.json({ message: res.locals.t('requestSuccess') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: res.locals.t('error') });
  }
});

app.get('/admin', (req, res) => {
  res.redirect(`/admin/login?lang=${res.locals.lang}`);
});

app.get('/admin/login', (req, res) => {
  res.render('admin/login', {
    t: res.locals.t,
    lang: res.locals.lang
  });
});

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const users = await readData('users.json');
  const user = users.find((u) => u.username === username);
  if (!user) {
    return res.render('admin/login', {
      t: res.locals.t,
      lang: res.locals.lang,
      error: res.locals.t('error')
    });
  }
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.render('admin/login', {
      t: res.locals.t,
      lang: res.locals.lang,
      error: res.locals.t('error')
    });
  }
  req.session.userId = user.id;
  req.session.user = user;
  if (user.mustChangePassword) {
    return res.redirect(`/admin/change-password?lang=${res.locals.lang}`);
  }
  res.redirect(`/admin/dashboard?lang=${res.locals.lang}`);
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect(`/admin/login?lang=${res.locals.lang}`);
  });
});

app.get('/admin/change-password', requireAuth, (req, res) => {
  res.render('admin/change-password', {
    t: res.locals.t,
    lang: res.locals.lang,
    mustChange: req.user.mustChangePassword
  });
});

app.post('/admin/change-password', requireAuth, async (req, res) => {
  const { password, passwordConfirm } = req.body;
  if (!password || password !== passwordConfirm) {
    return res.render('admin/change-password', {
      t: res.locals.t,
      lang: res.locals.lang,
      mustChange: req.user.mustChangePassword,
      error: res.locals.t('error')
    });
  }
  const users = await readData('users.json');
  const idx = users.findIndex((u) => u.id === req.user.id);
  if (idx === -1) {
    return res.render('admin/change-password', {
      t: res.locals.t,
      lang: res.locals.lang,
      mustChange: req.user.mustChangePassword,
      error: res.locals.t('error')
    });
  }
  users[idx].passwordHash = await bcrypt.hash(password, 10);
  users[idx].mustChangePassword = false;
  await writeData('users.json', users);
  req.session.user = users[idx];
  res.redirect(`/admin/dashboard?lang=${res.locals.lang}`);
});

app.get('/admin/dashboard', requireAuth, async (req, res) => {
  const settings = await readData('settings.json');
  res.render('admin/dashboard', {
    t: res.locals.t,
    lang: res.locals.lang,
    user: req.user,
    settings
  });
});

app.get('/admin/users', requireRole([ROLES.ADMIN]), async (req, res) => {
  const users = await readData('users.json');
  res.render('admin/users', {
    t: res.locals.t,
    lang: res.locals.lang,
    users,
    roles: ROLES
  });
});

app.post('/admin/users', requireRole([ROLES.ADMIN]), async (req, res) => {
  const { username, password, passwordConfirm, role } = req.body;
  if (!username || !password || password !== passwordConfirm) {
    const users = await readData('users.json');
    return res.render('admin/users', {
      t: res.locals.t,
      lang: res.locals.lang,
      users,
      roles: ROLES,
      error: res.locals.t('error')
    });
  }
  const users = await readData('users.json');
  if (users.find((u) => u.username === username)) {
    return res.render('admin/users', {
      t: res.locals.t,
      lang: res.locals.lang,
      users,
      roles: ROLES,
      error: res.locals.t('error')
    });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  users.push({
    id: uuidv4(),
    username,
    passwordHash,
    role,
    mustChangePassword: false
  });
  await writeData('users.json', users);
  res.redirect(`/admin/users?lang=${res.locals.lang}`);
});

app.post('/admin/users/:id/delete', requireRole([ROLES.ADMIN]), async (req, res) => {
  const id = req.params.id;
  let users = await readData('users.json');
  const user = users.find((u) => u.id === id);
  if (user && user.username !== 'root') {
    users = users.filter((u) => u.id !== id);
    await writeData('users.json', users);
  }
  res.redirect(`/admin/users?lang=${res.locals.lang}`);
});

app.get('/admin/menu', requireRole([ROLES.ADMIN, ROLES.BARMEN]), async (req, res) => {
  const menu = await readData('menu.json');
  res.render('admin/menu', {
    t: res.locals.t,
    lang: res.locals.lang,
    menu,
    roles: ROLES
  });
});

app.post('/admin/menu', requireRole([ROLES.ADMIN, ROLES.BARMEN]), async (req, res) => {
  const { titleRu, titleKk, descriptionRu, descriptionKk, price } = req.body;
  const menu = await readData('menu.json');
  menu.push({
    id: uuidv4(),
    title: { ru: titleRu, kk: titleKk },
    description: { ru: descriptionRu, kk: descriptionKk },
    price: Number(price) || 0,
    available: true
  });
  await writeData('menu.json', menu);
  res.redirect(`/admin/menu?lang=${res.locals.lang}`);
});

app.post('/admin/menu/:id', requireRole([ROLES.ADMIN, ROLES.BARMEN]), async (req, res) => {
  const { id } = req.params;
  const menu = await readData('menu.json');
  const item = menu.find((m) => m.id === id);
  if (item) {
    item.title.ru = req.body[`titleRu_${id}`] || item.title.ru;
    item.title.kk = req.body[`titleKk_${id}`] || item.title.kk;
    item.description.ru = req.body[`descriptionRu_${id}`] || item.description.ru;
    item.description.kk = req.body[`descriptionKk_${id}`] || item.description.kk;
    item.price = Number(req.body[`price_${id}`]) || item.price;
    item.available = req.body[`available_${id}`] === 'on';
    await writeData('menu.json', menu);
  }
  res.redirect(`/admin/menu?lang=${res.locals.lang}`);
});

app.post('/admin/menu/:id/delete', requireRole([ROLES.ADMIN, ROLES.BARMEN]), async (req, res) => {
  const { id } = req.params;
  const menu = await readData('menu.json');
  const updated = menu.filter((item) => item.id !== id);
  await writeData('menu.json', updated);
  res.redirect(`/admin/menu?lang=${res.locals.lang}`);
});

app.get('/admin/programs', requireRole([ROLES.ADMIN, ROLES.CASHIER]), async (req, res) => {
  const programs = await readData('programs.json');
  res.render('admin/programs', {
    t: res.locals.t,
    lang: res.locals.lang,
    programs
  });
});

app.post('/admin/programs', requireRole([ROLES.ADMIN, ROLES.CASHIER]), async (req, res) => {
  const { titleRu, titleKk, descriptionRu, descriptionKk, price, costumes } = req.body;
  const programs = await readData('programs.json');
  programs.push({
    id: uuidv4(),
    title: { ru: titleRu, kk: titleKk },
    description: { ru: descriptionRu, kk: descriptionKk },
    price: Number(price) || 0,
    available: true,
    costumes: costumes
      ? costumes
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : []
  });
  await writeData('programs.json', programs);
  res.redirect(`/admin/programs?lang=${res.locals.lang}`);
});

app.post('/admin/programs/:id', requireRole([ROLES.ADMIN, ROLES.CASHIER]), async (req, res) => {
  const { id } = req.params;
  const programs = await readData('programs.json');
  const program = programs.find((p) => p.id === id);
  if (program) {
    program.title.ru = req.body[`titleRu_${id}`] || program.title.ru;
    program.title.kk = req.body[`titleKk_${id}`] || program.title.kk;
    program.description.ru = req.body[`descriptionRu_${id}`] || program.description.ru;
    program.description.kk = req.body[`descriptionKk_${id}`] || program.description.kk;
    program.price = Number(req.body[`price_${id}`]) || program.price;
    program.available = req.body[`available_${id}`] === 'on';
    program.costumes = (req.body[`costumes_${id}`] || '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    await writeData('programs.json', programs);
  }
  res.redirect(`/admin/programs?lang=${res.locals.lang}`);
});

app.post('/admin/programs/:id/delete', requireRole([ROLES.ADMIN]), async (req, res) => {
  const { id } = req.params;
  const programs = await readData('programs.json');
  const updated = programs.filter((program) => program.id !== id);
  await writeData('programs.json', updated);
  res.redirect(`/admin/programs?lang=${res.locals.lang}`);
});

app.get('/admin/settings', requireRole([ROLES.ADMIN]), async (req, res) => {
  const settings = await readData('settings.json');
  res.render('admin/settings', {
    t: res.locals.t,
    lang: res.locals.lang,
    settings
  });
});

app.post('/admin/settings', requireRole([ROLES.ADMIN]), async (req, res) => {
  const settings = await readData('settings.json');
  settings.cafeNumber = req.body.cafeNumber;
  settings.cashierNumber = req.body.cashierNumber;
  settings.ownerAuthorized = req.body.ownerAuthorized === 'on';
  await writeData('settings.json', settings);
  res.redirect(`/admin/settings?lang=${res.locals.lang}`);
});

app.get('/admin/maintenance', requireRole([ROLES.ADMIN]), async (req, res) => {
  const settings = await readData('settings.json');
  res.render('admin/maintenance', {
    t: res.locals.t,
    lang: res.locals.lang,
    settings
  });
});

app.post('/admin/maintenance', requireRole([ROLES.ADMIN]), async (req, res) => {
  const settings = await readData('settings.json');
  settings.maintenance = req.body.maintenance === 'on';
  await writeData('settings.json', settings);
  res.redirect(`/admin/maintenance?lang=${res.locals.lang}`);
});

app.use((req, res) => {
  res.status(404).render('errors/404', {
    t: res.locals.t,
    lang: res.locals.lang,
    contactNumber: res.locals.contactNumber
  });
});

const PORT = process.env.PORT || 3000;

async function start() {
  await ensureDataFiles();
  await ensureRootUser();
  await loadTranslations();
  app.listen(PORT, () => {
    console.log(`Jungle Park server listening on port ${PORT}`);
  });
}

start();
