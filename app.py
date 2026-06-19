import json
import os
import secrets
import time
import uuid
from datetime import datetime
from functools import wraps
from threading import RLock

from flask import (
    Flask,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash


app = Flask(__name__)

# Secret key dipakai untuk session login dan CSRF token.
# Untuk demo localhost, nilai default aman dipakai. Untuk deployment, ganti melalui env MBG_SECRET_KEY.
app.config["SECRET_KEY"] = os.environ.get(
    "MBG_SECRET_KEY",
    "mbg-local-secret-key-ganti-jika-deploy-publik"
)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
# Aplikasi UAS berjalan di localhost HTTP, jadi secure cookie dibuat False.
# Jika memakai HTTPS sungguhan, ubah menjadi True melalui konfigurasi deployment.
app.config["SESSION_COOKIE_SECURE"] = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
NOTES_FILE = os.path.join(BASE_DIR, "notes.json")
USERS_FILE = os.path.join(BASE_DIR, "users.json")

NOTES_LOCK = RLock()
USERS_LOCK = RLock()
LOGIN_LOCK = RLock()
LOGIN_ATTEMPTS = {}
MAX_LOGIN_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 300

DEFAULT_USERNAME = os.environ.get("MBG_DEFAULT_USER", "admin")
DEFAULT_PASSWORD = os.environ.get("MBG_DEFAULT_PASSWORD", "mbg12345")
DEFAULT_DISPLAY_NAME = os.environ.get("MBG_DEFAULT_NAME", "Admin MBG")


def now_iso():
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


@app.after_request
def add_security_headers(response):
    # Proteksi ringan untuk aplikasi demo localhost.
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "media-src 'self'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    )
    return response


def ensure_notes_file():
    if not os.path.exists(NOTES_FILE):
        with NOTES_LOCK:
            if not os.path.exists(NOTES_FILE):
                with open(NOTES_FILE, "w", encoding="utf-8") as file:
                    json.dump([], file, indent=2)


def ensure_users_file():
    if not os.path.exists(USERS_FILE):
        with USERS_LOCK:
            if not os.path.exists(USERS_FILE):
                default_users = {
                    DEFAULT_USERNAME: {
                        "display_name": DEFAULT_DISPLAY_NAME,
                        "password_hash": generate_password_hash(DEFAULT_PASSWORD),
                        "created_at": now_iso(),
                    }
                }
                save_users(default_users)


def load_users():
    ensure_users_file()
    with USERS_LOCK:
        try:
            with open(USERS_FILE, "r", encoding="utf-8") as file:
                data = json.load(file)
                return data if isinstance(data, dict) else {}
        except (json.JSONDecodeError, OSError):
            return {}


def save_users(users):
    with USERS_LOCK:
        temp_file = f"{USERS_FILE}.tmp"
        with open(temp_file, "w", encoding="utf-8") as file:
            json.dump(users, file, indent=2, ensure_ascii=False)
        os.replace(temp_file, USERS_FILE)


def parse_tags(value):
    # Di UI disebut Label, di data tetap memakai key tags agar kompatibel dengan file lama.
    if isinstance(value, list):
        raw_tags = value
    elif isinstance(value, str):
        raw_tags = value.split(",")
    else:
        raw_tags = []

    tags = []
    seen = set()
    for tag in raw_tags:
        clean_tag = str(tag).strip()
        key = clean_tag.lower()
        if clean_tag and key not in seen:
            tags.append(clean_tag)
            seen.add(key)
    return tags


def parse_deadline(value):
    deadline = str(value or "").strip()
    if not deadline:
        return ""

    try:
        datetime.strptime(deadline, "%Y-%m-%d")
        return deadline
    except ValueError:
        return None


def parse_order(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def normalize_timestamp(value):
    timestamp = str(value or "").strip()
    if not timestamp:
        return now_iso()
    if "T" in timestamp:
        return timestamp
    if " " in timestamp:
        return timestamp.replace(" ", "T", 1)
    return timestamp


def normalize_note(note):
    parsed_deadline = parse_deadline(note.get("deadline"))
    labels_source = note.get("labels", note.get("tags"))
    return {
        "id": str(note.get("id") or uuid.uuid4()),
        "owner": str(note.get("owner") or DEFAULT_USERNAME).strip() or DEFAULT_USERNAME,
        "title": str(note.get("title") or "").strip(),
        "content": str(note.get("content") or "").strip(),
        "created_at": normalize_timestamp(note.get("created_at")),
        "updated_at": normalize_timestamp(note.get("updated_at") or note.get("created_at")),
        "order": parse_order(note.get("order"), 0),
        "labels": parse_tags(labels_source),
        "favorite": bool(note.get("favorite", False)),
        "deadline": parsed_deadline if parsed_deadline is not None else "",
    }


def serialize_note(note):
    # Owner tidak perlu dikirim ke browser karena data sudah difilter berdasarkan session user.
    labels = parse_tags(note.get("labels", note.get("tags")))
    return {
        "id": note["id"],
        "title": note["title"],
        "content": note["content"],
        "created_at": note["created_at"],
        "updated_at": note["updated_at"],
        "order": parse_order(note.get("order"), 0),
        "labels": labels,
        "tags": labels,
        "favorite": note["favorite"],
        "deadline": note["deadline"],
    }


def load_all_notes():
    ensure_notes_file()
    with NOTES_LOCK:
        try:
            with open(NOTES_FILE, "r", encoding="utf-8") as file:
                content = file.read().strip()
                if not content:
                    return []

                data = json.loads(content)
                if not isinstance(data, list):
                    return []

                normalized_notes = [normalize_note(note) for note in data if isinstance(note, dict)]
                if normalized_notes != data:
                    save_all_notes(normalized_notes)
                return normalized_notes
        except (json.JSONDecodeError, OSError):
            return []


def save_all_notes(notes):
    with NOTES_LOCK:
        temp_file = f"{NOTES_FILE}.tmp"
        with open(temp_file, "w", encoding="utf-8") as file:
            json.dump(notes, file, indent=2, ensure_ascii=False)
        os.replace(temp_file, NOTES_FILE)


def get_current_username():
    return session.get("username")


def get_csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


@app.context_processor
def inject_template_context():
    return {
        "csrf_token": get_csrf_token(),
        "current_user": session.get("display_name") or session.get("username") or "",
    }


def login_required(function):
    @wraps(function)
    def wrapper(*args, **kwargs):
        if not session.get("username"):
            if request.path.startswith("/api/"):
                return jsonify({
                    "success": False,
                    "message": "Sesi login sudah habis. Silakan login kembali."
                }), 401
            return redirect(url_for("login"))
        return function(*args, **kwargs)
    return wrapper


def csrf_is_valid():
    expected = session.get("csrf_token")
    submitted = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token")
    return bool(expected and submitted and secrets.compare_digest(expected, submitted))


def csrf_required(function):
    @wraps(function)
    def wrapper(*args, **kwargs):
        if not csrf_is_valid():
            if request.path.startswith("/api/"):
                return jsonify({
                    "success": False,
                    "message": "Token keamanan tidak valid. Muat ulang halaman lalu coba lagi."
                }), 403
            return render_template(
                "login.html",
                error="Token keamanan tidak valid. Muat ulang halaman lalu coba lagi.",
                username=request.form.get("username", ""),
            ), 403
        return function(*args, **kwargs)
    return wrapper


def get_login_key():
    return request.remote_addr or "local"


def is_login_limited(key):
    current_time = time.time()
    with LOGIN_LOCK:
        attempts = [
            attempt_time
            for attempt_time in LOGIN_ATTEMPTS.get(key, [])
            if current_time - attempt_time < LOGIN_WINDOW_SECONDS
        ]
        LOGIN_ATTEMPTS[key] = attempts
        return len(attempts) >= MAX_LOGIN_ATTEMPTS


def record_failed_login(key):
    current_time = time.time()
    with LOGIN_LOCK:
        attempts = LOGIN_ATTEMPTS.get(key, [])
        attempts.append(current_time)
        LOGIN_ATTEMPTS[key] = [
            attempt_time
            for attempt_time in attempts
            if current_time - attempt_time < LOGIN_WINDOW_SECONDS
        ]


def clear_failed_login(key):
    with LOGIN_LOCK:
        LOGIN_ATTEMPTS.pop(key, None)


def validate_note_payload(data):
    title = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()
    deadline = parse_deadline(data.get("deadline"))

    if not title or not content:
        return None, jsonify({
            "success": False,
            "message": "Judul dan isi catatan tidak boleh kosong."
        }), 400

    if deadline is None:
        return None, jsonify({
            "success": False,
            "message": "Format deadline harus YYYY-MM-DD."
        }), 400

    payload = {
        "title": title,
        "content": content,
        "labels": parse_tags(data.get("labels", data.get("tags"))),
        "favorite": bool(data.get("favorite", False)),
        "deadline": deadline,
    }
    return payload, None, None


@app.route("/login", methods=["GET", "POST"])
def login():
    ensure_users_file()

    if session.get("username") and request.method == "GET":
        return redirect(url_for("index"))

    error = ""
    username = ""

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        key = get_login_key()

        if not csrf_is_valid():
            error = "Token keamanan tidak valid. Muat ulang halaman lalu coba lagi."
        elif is_login_limited(key):
            error = "Terlalu banyak percobaan login. Tunggu beberapa menit lalu coba lagi."
        else:
            users = load_users()
            user = users.get(username)

            if user and check_password_hash(user.get("password_hash", ""), password):
                session.clear()
                session["username"] = username
                session["display_name"] = user.get("display_name") or username
                session["csrf_token"] = secrets.token_urlsafe(32)
                clear_failed_login(key)
                return redirect(url_for("index"))

            record_failed_login(key)
            error = "Username atau password salah."

    get_csrf_token()
    return render_template("login.html", error=error, username=username)


@app.route("/logout", methods=["POST"])
@login_required
@csrf_required
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def index():
    return render_template("index.html")


@app.route("/api/notes", methods=["GET"])
@login_required
def get_notes():
    username = get_current_username()
    notes = [note for note in load_all_notes() if note.get("owner") == username]
    label_filter = (request.args.get("label") or "").strip().lower()
    favorite_filter = (request.args.get("favorite") or "").strip().lower()

    if label_filter:
        notes = [
            note for note in notes
            if any(label.lower() == label_filter for label in parse_tags(note.get("labels", note.get("tags"))))
        ]

    if favorite_filter in {"true", "1", "yes"}:
        notes = [note for note in notes if note.get("favorite")]

    return jsonify({
        "success": True,
        "message": "Daftar catatan berhasil diambil.",
        "data": [serialize_note(note) for note in notes]
    })


@app.route("/api/labels", methods=["GET"])
@login_required
def get_labels():
    username = get_current_username()
    label_map = {}

    for note in load_all_notes():
        if note.get("owner") != username:
            continue
        for label in parse_tags(note.get("labels", note.get("tags"))):
            key = label.lower()
            label_map.setdefault(key, {"name": label, "count": 0})
            label_map[key]["count"] += 1

    labels = sorted(label_map.values(), key=lambda item: item["name"].lower())
    return jsonify({
        "success": True,
        "message": "Daftar label berhasil diambil.",
        "data": labels
    })


@app.route("/api/notes", methods=["POST"])
@login_required
@csrf_required
def create_note():
    data = request.get_json(silent=True) or {}
    payload, error_response, status_code = validate_note_payload(data)

    if error_response:
        return error_response, status_code

    with NOTES_LOCK:
        notes = load_all_notes()
        timestamp = now_iso()
        user_notes = [note for note in notes if note.get("owner") == get_current_username()]
        next_order = min([parse_order(note.get("order"), index) for index, note in enumerate(user_notes)] or [0]) - 1
        note = {
            "id": str(uuid.uuid4()),
            "owner": get_current_username(),
            "title": payload["title"],
            "content": payload["content"],
            "created_at": timestamp,
            "updated_at": timestamp,
            "order": next_order,
            "labels": payload["labels"],
            "favorite": payload["favorite"],
            "deadline": payload["deadline"],
        }
        notes.insert(0, note)
        save_all_notes(notes)

    return jsonify({
        "success": True,
        "message": "Catatan berhasil ditambahkan.",
        "data": serialize_note(note)
    }), 201


@app.route("/api/notes/<note_id>", methods=["PUT"])
@login_required
@csrf_required
def update_note(note_id):
    data = request.get_json(silent=True) or {}
    payload, error_response, status_code = validate_note_payload(data)

    if error_response:
        return error_response, status_code

    username = get_current_username()
    with NOTES_LOCK:
        notes = load_all_notes()

        for note in notes:
            if note.get("id") == note_id and note.get("owner") == username:
                note["title"] = payload["title"]
                note["content"] = payload["content"]
                note["labels"] = payload["labels"]
                note.pop("tags", None)
                note["favorite"] = payload["favorite"]
                note["deadline"] = payload["deadline"]
                note["updated_at"] = now_iso()
                save_all_notes(notes)

                return jsonify({
                    "success": True,
                    "message": "Catatan berhasil diperbarui.",
                    "data": serialize_note(note)
                })

    return jsonify({
        "success": False,
        "message": "Catatan tidak ditemukan."
    }), 404



@app.route("/api/notes/reorder", methods=["POST"])
@login_required
@csrf_required
def reorder_notes():
    data = request.get_json(silent=True) or {}
    order_ids = data.get("order")

    if not isinstance(order_ids, list):
        return jsonify({
            "success": False,
            "message": "Format urutan catatan tidak valid."
        }), 400

    username = get_current_username()
    clean_ids = []
    seen = set()
    for raw_id in order_ids:
        note_id = str(raw_id or "").strip()
        if note_id and note_id not in seen:
            clean_ids.append(note_id)
            seen.add(note_id)

    with NOTES_LOCK:
        notes = load_all_notes()
        user_notes = [note for note in notes if note.get("owner") == username]
        user_ids = {note.get("id") for note in user_notes}

        if not set(clean_ids).issubset(user_ids):
            return jsonify({
                "success": False,
                "message": "Ada catatan yang tidak valid pada urutan baru."
            }), 400

        missing_ids = [note.get("id") for note in sorted(user_notes, key=lambda item: parse_order(item.get("order"), 0)) if note.get("id") not in seen]
        final_ids = clean_ids + missing_ids
        order_map = {note_id: index for index, note_id in enumerate(final_ids)}

        for note in notes:
            if note.get("owner") == username and note.get("id") in order_map:
                note["order"] = order_map[note.get("id")]
                note["updated_at"] = note.get("updated_at") or now_iso()

        save_all_notes(notes)

    return jsonify({
        "success": True,
        "message": "Urutan catatan berhasil disimpan."
    })


@app.route("/api/notes/<note_id>", methods=["DELETE"])
@login_required
@csrf_required
def delete_note(note_id):
    username = get_current_username()
    with NOTES_LOCK:
        notes = load_all_notes()
        note_exists = any(
            note.get("id") == note_id and note.get("owner") == username
            for note in notes
        )

        if not note_exists:
            return jsonify({
                "success": False,
                "message": "Catatan tidak ditemukan."
            }), 404

        filtered_notes = [
            note for note in notes
            if not (note.get("id") == note_id and note.get("owner") == username)
        ]
        save_all_notes(filtered_notes)

    return jsonify({
        "success": True,
        "message": "Catatan berhasil dihapus."
    })


if __name__ == "__main__":
    ensure_notes_file()
    ensure_users_file()
    # Debug dimatikan agar lebih aman untuk versi pengumpulan.
    app.run(debug=False)
