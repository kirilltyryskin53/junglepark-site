import base64
import datetime as dt
import hashlib
import json
import os
import uuid
from functools import wraps
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import (
    Flask,
    abort,
    flash,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
TRANSLATION_DIR = BASE_DIR / "translations"

SUPPORTED_LANGUAGES = {"ru", "kk"}
DEFAULT_LANG = "ru"

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key")


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return f"{base64.b64encode(salt).decode()}:{base64.b64encode(dk).decode()}"


def verify_password(stored_hash: str, password: str) -> bool:
    try:
        salt_b64, hash_b64 = stored_hash.split(":", 1)
        salt = base64.b64decode(salt_b64.encode())
        expected = base64.b64decode(hash_b64.encode())
    except Exception:
        return False
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return hashlib.compare_digest(candidate, expected)


def to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


TRANSLATIONS: Dict[str, Dict[str, str]] = {
    lang: load_json(TRANSLATION_DIR / f"{lang}.json", {}) for lang in SUPPORTED_LANGUAGES
}


def get_settings() -> Dict[str, Any]:
    return load_json(
        DATA_DIR / "settings.json",
        {
            "ownerAuthorized": False,
            "cafeNumber": "+7 705 561 9337",
            "cashierNumber": "+7 705 123 4567",
            "maintenance": False,
        },
    )


def save_settings(settings: Dict[str, Any]) -> None:
    save_json(DATA_DIR / "settings.json", settings)


def get_users() -> List[Dict[str, Any]]:
    return load_json(DATA_DIR / "users.json", [])


def save_users(users: List[Dict[str, Any]]) -> None:
    save_json(DATA_DIR / "users.json", users)


def get_menu() -> List[Dict[str, Any]]:
    return load_json(DATA_DIR / "menu.json", [])


def save_menu(menu: List[Dict[str, Any]]) -> None:
    save_json(DATA_DIR / "menu.json", menu)


def get_programs() -> List[Dict[str, Any]]:
    return load_json(DATA_DIR / "programs.json", [])


def save_programs(programs: List[Dict[str, Any]]) -> None:
    save_json(DATA_DIR / "programs.json", programs)


def get_banners() -> List[Dict[str, Any]]:
    return load_json(DATA_DIR / "banners.json", [])


def save_banners(banners: List[Dict[str, Any]]) -> None:
    save_json(DATA_DIR / "banners.json", banners)


def log_whatsapp(message: str) -> None:
    log_path = DATA_DIR / "whatsapp-log.json"
    entries = load_json(log_path, [])
    entries.append({
        "timestamp": dt.datetime.utcnow().isoformat() + "Z",
        "message": message,
    })
    save_json(log_path, entries)


def get_lang() -> str:
    if hasattr(g, "lang"):
        return g.lang
    lang = session.get("lang", DEFAULT_LANG)
    return lang if lang in SUPPORTED_LANGUAGES else DEFAULT_LANG


def translate(key: str) -> str:
    lang = get_lang()
    return TRANSLATIONS.get(lang, {}).get(key, key)


def with_language(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        lang_param = request.args.get("lang")
        if lang_param in SUPPORTED_LANGUAGES:
            session["lang"] = lang_param
        g.lang = session.get("lang", DEFAULT_LANG)
        if g.lang not in SUPPORTED_LANGUAGES:
            g.lang = DEFAULT_LANG
        return fn(*args, **kwargs)

    return wrapper


def current_user() -> Optional[Dict[str, Any]]:
    username = session.get("username")
    if not username:
        return None
    for user in get_users():
        if user.get("username") == username:
            return user
    return None


def login_required(role: Optional[str] = None):
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            user = current_user()
            if not user:
                return redirect(url_for("admin_login"))
            if role and user.get("role") != role and user.get("role") != "Administrator":
                abort(403)
            return fn(*args, **kwargs)

        return wrapped

    return decorator


@app.before_request
def enforce_maintenance():
    if request.endpoint == "static":
        return
    if request.path.startswith("/admin"):
        return
    settings = get_settings()
    if settings.get("maintenance") and request.endpoint not in {"maintenance", "admin_login"}:
        return redirect(url_for("maintenance"))


@app.context_processor
def inject_globals():
    return {
        "t": translate,
        "lang": get_lang(),
        "supported_languages": SUPPORTED_LANGUAGES,
        "settings": get_settings(),
        "current_user": current_user(),
    }


@app.route("/maintenance")
@with_language
def maintenance():
    return render_template("maintenance.html")


@app.route("/")
@with_language
def home():
    menu = [item for item in get_menu() if item.get("available", True)]
    programs = [p for p in get_programs() if p.get("available", True)]
    banners = get_banners()
    return render_template("home.html", menu=menu, programs=programs, banners=banners)


@app.route("/menu")
@with_language
def menu():
    menu_items = [item for item in get_menu() if item.get("available", True)]
    add_item = request.args.get("addItem")
    return render_template("menu.html", menu=menu_items, add_item=add_item)


@app.route("/programs")
@with_language
def programs():
    programs_list = [p for p in get_programs() if p.get("available", True)]
    return render_template("programs.html", programs=programs_list)


@app.post("/api/order")
@with_language
def api_order():
    data = request.get_json(force=True)
    items = data.get("items", [])
    total = data.get("total")
    address = data.get("address", "").strip()
    phone = data.get("phone", "").strip()
    if not items or not total or not address or not phone:
        return jsonify({"error": "missing_fields"}), 400
    settings = get_settings()
    message = (
        "📦 Новый заказ из кафе Jungle Park:\n"
        f"Позиции: {', '.join(items)}\n"
        f"Общая сумма: {total} тг\n"
        f"Адрес: {address}\n"
        f"Телефон клиента: {phone}"
    )
    log_whatsapp(message)
    return jsonify({"success": True, "recipient": settings.get("cafeNumber")})


@app.post("/api/program-request")
@with_language
def api_program_request():
    data = request.get_json(force=True)
    program_id = data.get("programId")
    name = data.get("name", "").strip()
    child_name = data.get("childName", "").strip()
    date = data.get("date", "").strip()
    phone = data.get("phone", "").strip()
    programs = {p["id"]: p for p in get_programs()}
    program = programs.get(program_id)
    if not program or not name or not child_name or not date or not phone:
        return jsonify({"error": "missing_fields"}), 400
    title = program.get("title", {}).get(get_lang(), program.get("title", {}).get("ru", program_id))
    message = (
        "🎉 Новая заявка на программу Jungle Park:\n"
        f"Программа: {title}\n"
        f"Имя ребёнка: {child_name}\n"
        f"Дата: {date}\n"
        f"Контакт: {phone}"
    )
    log_whatsapp(message)
    settings = get_settings()
    return jsonify({"success": True, "recipient": settings.get("cashierNumber")})


@app.post("/api/banner-signup/<banner_id>")
@with_language
def api_banner_signup(banner_id: str):
    data = request.get_json(force=True)
    child_name = data.get("childName", "").strip()
    parent_name = data.get("parentName", "").strip()
    age = data.get("age", "").strip()
    phone = data.get("phone", "").strip()
    if not child_name or not parent_name or not age or not phone:
        return jsonify({"error": "missing_fields"}), 400
    banners = {b["id"]: b for b in get_banners() if b.get("type") == "seasonal"}
    banner = banners.get(banner_id)
    if not banner:
        return jsonify({"error": "unknown_banner"}), 404
    program_title = banner.get(f"title_{get_lang()}") or banner.get("title_ru", banner_id)
    message = (
        "🎉 Новая заявка на программу Jungle Park:\n"
        f"Программа: {program_title}\n"
        f"Имя ребёнка: {child_name}\n"
        f"Возраст: {age}\n"
        f"Контакт: {phone}\n"
        f"ФИ родителя: {parent_name}"
    )
    log_whatsapp(message)
    settings = get_settings()
    return jsonify({"success": True, "recipient": settings.get("cashierNumber")})


@app.route("/admin", methods=["GET", "POST"])
@with_language
def admin_login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        for user in get_users():
            if user.get("username") == username and verify_password(user.get("password_hash", ""), password):
                session["username"] = user["username"]
                if user.get("must_change_password"):
                    flash(translate("changePasswordPrompt"), "warning")
                    return redirect(url_for("change_password"))
                return redirect(url_for("admin_dashboard"))
        flash(translate("invalidCredentials"), "danger")
    return render_template("admin/login.html")


@app.route("/admin/logout")
@login_required()
@with_language
def admin_logout():
    session.pop("username", None)
    return redirect(url_for("admin_login"))


@app.route("/admin/change-password", methods=["GET", "POST"])
@login_required()
@with_language
def change_password():
    user = current_user()
    if request.method == "POST":
        current_pwd = request.form.get("currentPassword", "")
        new_pwd = request.form.get("newPassword", "")
        confirm_pwd = request.form.get("confirmPassword", "")
        if not verify_password(user.get("password_hash", ""), current_pwd):
            flash(translate("currentPasswordInvalid"), "danger")
        elif len(new_pwd) < 6:
            flash(translate("passwordTooShort"), "danger")
        elif new_pwd != confirm_pwd:
            flash(translate("passwordMismatch"), "danger")
        else:
            users = get_users()
            for entry in users:
                if entry.get("username") == user["username"]:
                    entry["password_hash"] = hash_password(new_pwd)
                    entry["must_change_password"] = False
            save_users(users)
            flash(translate("passwordUpdated"), "success")
            return redirect(url_for("admin_dashboard"))
    return render_template("admin/change-password.html")


@app.route("/admin/dashboard")
@login_required()
@with_language
def admin_dashboard():
    return render_template("admin/dashboard.html")


@app.route("/admin/users", methods=["GET", "POST"])
@login_required()
@with_language
def admin_users():
    user = current_user()
    if user.get("role") != "Administrator":
        abort(403)
    users = get_users()
    if request.method == "POST":
        action = request.form.get("action")
        if action == "create":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            role = request.form.get("role", "Administrator")
            if not username or not password:
                flash(translate("userMissingFields"), "danger")
            elif any(u.get("username") == username for u in users):
                flash(translate("userExists"), "danger")
            else:
                users.append({
                    "id": str(uuid.uuid4()),
                    "username": username,
                    "password_hash": hash_password(password),
                    "role": role,
                    "must_change_password": False,
                })
                save_users(users)
                flash(translate("userCreated"), "success")
                return redirect(url_for("admin_users"))
        elif action == "update":
            user_id = request.form.get("userId")
            role = request.form.get("role")
            for entry in users:
                if entry.get("id") == user_id and entry.get("username") != "root":
                    entry["role"] = role
            save_users(users)
            flash(translate("userUpdated"), "success")
            return redirect(url_for("admin_users"))
        elif action == "delete":
            user_id = request.form.get("userId")
            users = [u for u in users if u.get("id") != user_id and u.get("username") != "root"]
            save_users(users)
            flash(translate("userDeleted"), "success")
            return redirect(url_for("admin_users"))
    return render_template("admin/users.html", users=users)


@app.route("/admin/menu", methods=["GET", "POST"])
@login_required()
@with_language
def admin_menu():
    user = current_user()
    if user.get("role") not in {"Administrator", "Бармен"}:
        abort(403)
    menu = get_menu()
    if request.method == "POST":
        action_values = request.form.getlist("action")
        action = action_values[-1] if action_values else None
        if action == "create":
            title_ru = request.form.get("title_ru", "").strip()
            title_kk = request.form.get("title_kk", "").strip()
            description_ru = request.form.get("description_ru", "").strip()
            description_kk = request.form.get("description_kk", "").strip()
            price = to_int(request.form.get("price", "0"))
            menu.append({
                "id": str(uuid.uuid4()),
                "title": {"ru": title_ru, "kk": title_kk},
                "description": {"ru": description_ru, "kk": description_kk},
                "price": price,
                "available": request.form.get("available") == "on",
            })
            save_menu(menu)
            flash(translate("menuUpdated"), "success")
            return redirect(url_for("admin_menu"))
        elif action == "update":
            item_id = request.form.get("item_id")
            for item in menu:
                if item.get("id") == item_id:
                    item["title"] = {
                        "ru": request.form.get("title_ru", "").strip(),
                        "kk": request.form.get("title_kk", "").strip(),
                    }
                    item["description"] = {
                        "ru": request.form.get("description_ru", "").strip(),
                        "kk": request.form.get("description_kk", "").strip(),
                    }
                    item["price"] = to_int(request.form.get("price", item.get("price", 0)))
                    item["available"] = request.form.get("available") == "on"
            save_menu(menu)
            flash(translate("menuUpdated"), "success")
            return redirect(url_for("admin_menu"))
        elif action == "delete":
            item_id = request.form.get("item_id")
            menu = [item for item in menu if item.get("id") != item_id]
            save_menu(menu)
            flash(translate("menuUpdated"), "success")
            return redirect(url_for("admin_menu"))
    return render_template("admin/menu.html", menu=menu)


@app.route("/admin/programs", methods=["GET", "POST"])
@login_required()
@with_language
def admin_programs():
    user = current_user()
    if user.get("role") not in {"Administrator", "Кассир"}:
        abort(403)
    programs = get_programs()
    if request.method == "POST":
        action_values = request.form.getlist("action")
        action = action_values[-1] if action_values else None
        if action == "create":
            title_ru = request.form.get("title_ru", "").strip()
            title_kk = request.form.get("title_kk", "").strip()
            description_ru = request.form.get("description_ru", "").strip()
            description_kk = request.form.get("description_kk", "").strip()
            price = to_int(request.form.get("price", "0"))
            costumes = [c.strip() for c in request.form.get("costumes", "").split(",") if c.strip()]
            programs.append({
                "id": str(uuid.uuid4()),
                "title": {"ru": title_ru, "kk": title_kk},
                "description": {"ru": description_ru, "kk": description_kk},
                "price": price,
                "available": request.form.get("available") == "on",
                "costumes": costumes,
            })
            save_programs(programs)
            flash(translate("programUpdated"), "success")
            return redirect(url_for("admin_programs"))
        elif action == "update":
            program_id = request.form.get("program_id")
            for program in programs:
                if program.get("id") == program_id:
                    program["title"] = {
                        "ru": request.form.get("title_ru", "").strip(),
                        "kk": request.form.get("title_kk", "").strip(),
                    }
                    program["description"] = {
                        "ru": request.form.get("description_ru", "").strip(),
                        "kk": request.form.get("description_kk", "").strip(),
                    }
                    program["price"] = to_int(request.form.get("price", program.get("price", 0)))
                    program["available"] = request.form.get("available") == "on"
                    program["costumes"] = [c.strip() for c in request.form.get("costumes", "").split(",") if c.strip()]
            save_programs(programs)
            flash(translate("programUpdated"), "success")
            return redirect(url_for("admin_programs"))
        elif action == "delete":
            program_id = request.form.get("program_id")
            programs = [program for program in programs if program.get("id") != program_id]
            save_programs(programs)
            flash(translate("programUpdated"), "success")
            return redirect(url_for("admin_programs"))
    return render_template("admin/programs.html", programs=programs)


@app.route("/admin/banners", methods=["GET", "POST"])
@login_required()
@with_language
def admin_banners():
    user = current_user()
    if user.get("role") != "Administrator":
        abort(403)
    banners = get_banners()
    programs = get_programs()
    menu = get_menu()
    if request.method == "POST":
        action_values = request.form.getlist("action")
        action = action_values[-1] if action_values else None
        if action == "create":
            banner_type = request.form.get("type")
            banner = {
                "id": str(uuid.uuid4()),
                "type": banner_type,
                "title_ru": request.form.get("title_ru", "").strip(),
                "title_kk": request.form.get("title_kk", "").strip(),
                "description_ru": request.form.get("description_ru", "").strip(),
                "description_kk": request.form.get("description_kk", "").strip(),
            }
            if banner_type == "seasonal":
                banner["program_id"] = request.form.get("program_id")
                banner["cta_label_ru"] = request.form.get("cta_ru", "").strip() or "Записаться"
                banner["cta_label_kk"] = request.form.get("cta_kk", "").strip() or "Тіркелу"
            elif banner_type == "discount":
                banner["menu_item_id"] = request.form.get("menu_item_id")
            banners.append(banner)
            save_banners(banners)
            flash(translate("bannersUpdated"), "success")
            return redirect(url_for("admin_banners"))
        elif action == "update":
            banner_id = request.form.get("banner_id")
            for banner in banners:
                if banner.get("id") == banner_id:
                    banner["title_ru"] = request.form.get("title_ru", "").strip()
                    banner["title_kk"] = request.form.get("title_kk", "").strip()
                    banner["description_ru"] = request.form.get("description_ru", "").strip()
                    banner["description_kk"] = request.form.get("description_kk", "").strip()
                    if banner.get("type") == "seasonal":
                        banner["program_id"] = request.form.get("program_id")
                        banner["cta_label_ru"] = request.form.get("cta_ru", "").strip() or "Записаться"
                        banner["cta_label_kk"] = request.form.get("cta_kk", "").strip() or "Тіркелу"
                    else:
                        banner["menu_item_id"] = request.form.get("menu_item_id")
            save_banners(banners)
            flash(translate("bannersUpdated"), "success")
            return redirect(url_for("admin_banners"))
        elif action == "delete":
            banner_id = request.form.get("banner_id")
            banners = [b for b in banners if b.get("id") != banner_id]
            save_banners(banners)
            flash(translate("bannersUpdated"), "success")
            return redirect(url_for("admin_banners"))
    return render_template("admin/banners.html", banners=banners, programs=programs, menu=menu)


@app.route("/admin/settings", methods=["GET", "POST"])
@login_required()
@with_language
def admin_settings():
    user = current_user()
    if user.get("role") != "Administrator":
        abort(403)
    settings = get_settings()
    if request.method == "POST":
        settings["ownerAuthorized"] = request.form.get("ownerAuthorized") == "on"
        settings["cafeNumber"] = request.form.get("cafeNumber", "").strip()
        settings["cashierNumber"] = request.form.get("cashierNumber", "").strip()
        save_settings(settings)
        flash(translate("settingsUpdated"), "success")
        return redirect(url_for("admin_settings"))
    return render_template("admin/settings.html", settings=settings)


@app.route("/admin/maintenance", methods=["GET", "POST"])
@login_required()
@with_language
def admin_maintenance():
    user = current_user()
    if user.get("role") != "Administrator":
        abort(403)
    settings = get_settings()
    if request.method == "POST":
        settings["maintenance"] = request.form.get("maintenance") == "on"
        save_settings(settings)
        flash(translate("maintenanceUpdated"), "success")
        return redirect(url_for("admin_maintenance"))
    return render_template("admin/maintenance.html", settings=settings)


@app.errorhandler(403)
@with_language
def forbidden(_):
    return render_template("errors/403.html"), 403


@app.errorhandler(404)
@with_language
def not_found(_):
    return render_template("errors/404.html"), 404


if __name__ == "__main__":
    app.run(debug=True)
