import base64
import binascii
import json
import os
import sqlite3
import urllib.error
import urllib.request
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from werkzeug.exceptions import RequestEntityTooLarge


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 7 * 1024 * 1024
DATABASE = os.environ.get("DATABASE_PATH", str(Path(__file__).with_name("study_planner.db")))
COURSE_COLORS = {"#7567e8", "#47a987", "#e99865", "#5598c8"}
MAX_BUDDY_IMAGE_BYTES = 5 * 1024 * 1024
MAX_BUDDY_MESSAGES = 20
MAX_BUDDY_MESSAGE_LENGTH = 4000


def connect_db():
    if DATABASE != ":memory:":
        Path(DATABASE).parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_db():
    with connect_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                code TEXT NOT NULL DEFAULT '',
                instructor TEXT NOT NULL DEFAULT '',
                color TEXT NOT NULL DEFAULT '#7567e8'
            );
            CREATE TABLE IF NOT EXISTS assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
                due_date TEXT NOT NULL DEFAULT '',
                estimate INTEGER NOT NULL DEFAULT 0,
                seconds_spent INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'To do'
                    CHECK (status IN ('To do', 'In progress', 'Done'))
            );
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )


def json_body():
    return request.get_json(silent=True) or {}


def require_text(data, field):
    value = data.get(field)
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()


def row_dict(row):
    return dict(row) if row else None


@app.get("/")
def home():
    return render_template("index.html")


@app.errorhandler(RequestEntityTooLarge)
def request_too_large(_error):
    return jsonify(error="That upload is too large. Buddy accepts images up to 5 MB."), 413


@app.get("/api/data")
def get_data():
    with connect_db() as db:
        courses = db.execute("SELECT * FROM courses ORDER BY name").fetchall()
        assignments = db.execute(
            """
            SELECT assignments.*, courses.name AS course_name, courses.color AS course_color
            FROM assignments LEFT JOIN courses ON courses.id = assignments.course_id
            ORDER BY CASE WHEN due_date = '' THEN 1 ELSE 0 END, due_date, id DESC
            """
        ).fetchall()
        notes = db.execute(
            """
            SELECT notes.*, courses.name AS course_name
            FROM notes LEFT JOIN courses ON courses.id = notes.course_id
            ORDER BY updated_at DESC, id DESC
            """
        ).fetchall()
    return jsonify(courses=[row_dict(row) for row in courses],
                   assignments=[row_dict(row) for row in assignments],
                   notes=[row_dict(row) for row in notes])


@app.post("/api/courses")
def create_course():
    data = json_body()
    name = require_text(data, "name")
    if not name:
        return jsonify(error="Course name is required."), 400
    color = data.get("color", "#7567e8")
    if color not in COURSE_COLORS:
        return jsonify(error="Choose a valid course color."), 400
    with connect_db() as db:
        cursor = db.execute(
            "INSERT INTO courses (name, code, instructor, color) VALUES (?, ?, ?, ?)",
            (name, str(data.get("code", "")).strip(), str(data.get("instructor", "")).strip(),
             color),
        )
        course = db.execute("SELECT * FROM courses WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return jsonify(row_dict(course)), 201


@app.delete("/api/courses/<int:course_id>")
def delete_course(course_id):
    with connect_db() as db:
        cursor = db.execute("DELETE FROM courses WHERE id = ?", (course_id,))
    if cursor.rowcount == 0:
        return jsonify(error="Course not found."), 404
    return "", 204


@app.post("/api/assignments")
def create_assignment():
    data = json_body()
    title = require_text(data, "title")
    if not title:
        return jsonify(error="Assignment title is required."), 400
    try:
        estimate = max(0, int(data.get("estimate", 0)))
        course_id = int(data["course_id"]) if data.get("course_id") else None
    except (TypeError, ValueError):
        return jsonify(error="Choose a valid course and time estimate."), 400
    with connect_db() as db:
        if course_id and not db.execute("SELECT 1 FROM courses WHERE id = ?", (course_id,)).fetchone():
            return jsonify(error="That course does not exist."), 400
        cursor = db.execute(
            "INSERT INTO assignments (title, course_id, due_date, estimate) VALUES (?, ?, ?, ?)",
            (title, course_id, str(data.get("due_date", "")), estimate),
        )
        assignment = db.execute(
            """
            SELECT assignments.*, courses.name AS course_name, courses.color AS course_color
            FROM assignments LEFT JOIN courses ON courses.id = assignments.course_id
            WHERE assignments.id = ?
            """,
            (cursor.lastrowid,),
        ).fetchone()
    return jsonify(row_dict(assignment)), 201


@app.patch("/api/assignments/<int:assignment_id>")
def update_assignment(assignment_id):
    data = json_body()
    allowed = {"status": ("To do", "In progress", "Done")}
    if "status" not in data or data["status"] not in allowed["status"]:
        return jsonify(error="Choose a valid assignment status."), 400
    with connect_db() as db:
        cursor = db.execute("UPDATE assignments SET status = ? WHERE id = ?",
                            (data["status"], assignment_id))
    if cursor.rowcount == 0:
        return jsonify(error="Assignment not found."), 404
    return jsonify(success=True)


@app.post("/api/assignments/<int:assignment_id>/time")
def add_assignment_time(assignment_id):
    data = json_body()
    try:
        seconds = int(data.get("seconds", 0))
    except (TypeError, ValueError):
        return jsonify(error="Time must be a positive number of seconds."), 400
    if not 1 <= seconds <= 3600:
        return jsonify(error="Time entry must be between 1 second and 1 hour."), 400
    with connect_db() as db:
        cursor = db.execute(
            "UPDATE assignments SET seconds_spent = seconds_spent + ?, status = 'In progress' WHERE id = ?",
            (seconds, assignment_id),
        )
    if cursor.rowcount == 0:
        return jsonify(error="Assignment not found."), 404
    return jsonify(success=True)


@app.delete("/api/assignments/<int:assignment_id>")
def delete_assignment(assignment_id):
    with connect_db() as db:
        cursor = db.execute("DELETE FROM assignments WHERE id = ?", (assignment_id,))
    if cursor.rowcount == 0:
        return jsonify(error="Assignment not found."), 404
    return "", 204


@app.post("/api/notes")
def create_note():
    data = json_body()
    title = require_text(data, "title")
    if not title:
        return jsonify(error="Note title is required."), 400
    course_id = data.get("course_id")
    try:
        course_id = int(course_id) if course_id else None
    except (TypeError, ValueError):
        return jsonify(error="Choose a valid course."), 400
    with connect_db() as db:
        if course_id and not db.execute("SELECT 1 FROM courses WHERE id = ?", (course_id,)).fetchone():
            return jsonify(error="That course does not exist."), 400
        cursor = db.execute(
            "INSERT INTO notes (title, content, course_id, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
            (title, str(data.get("content", "")).strip(), course_id),
        )
        note = db.execute(
            """
            SELECT notes.*, courses.name AS course_name
            FROM notes LEFT JOIN courses ON courses.id = notes.course_id
            WHERE notes.id = ?
            """,
            (cursor.lastrowid,),
        ).fetchone()
    return jsonify(row_dict(note)), 201


@app.put("/api/notes/<int:note_id>")
def update_note(note_id):
    data = json_body()
    title = require_text(data, "title")
    if not title:
        return jsonify(error="Note title is required."), 400
    course_id = data.get("course_id")
    try:
        course_id = int(course_id) if course_id else None
    except (TypeError, ValueError):
        return jsonify(error="Choose a valid course."), 400
    with connect_db() as db:
        if course_id and not db.execute("SELECT 1 FROM courses WHERE id = ?", (course_id,)).fetchone():
            return jsonify(error="That course does not exist."), 400
        cursor = db.execute(
            """
            UPDATE notes SET title = ?, content = ?, course_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (title, str(data.get("content", "")).strip(), course_id, note_id),
        )
    if cursor.rowcount == 0:
        return jsonify(error="Note not found."), 404
    return jsonify(success=True)


@app.delete("/api/notes/<int:note_id>")
def delete_note(note_id):
    with connect_db() as db:
        cursor = db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    if cursor.rowcount == 0:
        return jsonify(error="Note not found."), 404
    return "", 204


@app.post("/api/buddy/chat")
def buddy_chat():
    data = json_body()
    if not isinstance(data, dict):
        return jsonify(error="Send a question for Buddy to answer."), 400
    messages = data.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= MAX_BUDDY_MESSAGES:
        return jsonify(error="Start a chat with a question for Buddy."), 400

    conversation = []
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in {"user", "assistant"}:
            return jsonify(error="That chat message is not valid."), 400
        content = message.get("content")
        if not isinstance(content, str) or not content.strip() or len(content) > MAX_BUDDY_MESSAGE_LENGTH:
            return jsonify(error="Chat messages must be between 1 and 4,000 characters."), 400
        conversation.append({"role": message["role"], "content": content.strip()})
    if conversation[-1]["role"] != "user":
        return jsonify(error="Send a question before Buddy replies."), 400

    image = data.get("image")
    image_bytes = None
    if image is not None:
        if not isinstance(image, dict) or image.get("mime_type") not in {"image/jpeg", "image/png"}:
            return jsonify(error="Buddy can read PNG and JPEG images."), 400
        encoded = image.get("data")
        if not isinstance(encoded, str) or len(encoded) > ((MAX_BUDDY_IMAGE_BYTES + 2) // 3) * 4:
            return jsonify(error="Images must be 5 MB or smaller."), 400
        try:
            image_bytes = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            return jsonify(error="That image could not be read. Try uploading it again."), 400
        if not image_bytes or len(image_bytes) > MAX_BUDDY_IMAGE_BYTES:
            return jsonify(error="Images must be between 1 byte and 5 MB."), 400
        valid_signature = (
            image["mime_type"] == "image/png" and image_bytes.startswith(b"\x89PNG\r\n\x1a\n")
        ) or (
            image["mime_type"] == "image/jpeg" and image_bytes.startswith(b"\xff\xd8\xff")
        )
        if not valid_signature:
            return jsonify(error="The image file does not match its PNG or JPEG format."), 400

    ollama_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    model = os.environ.get("OLLAMA_MODEL", "llama3.2-vision")
    if image_bytes:
        conversation[-1]["images"] = [base64.b64encode(image_bytes).decode("ascii")]
    payload = {
        "model": model,
        "stream": False,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are Buddy, a kind and patient study assistant for students. "
                    "Help explain schoolwork step by step, ask a clarifying question when needed, "
                    "and encourage understanding rather than simply giving unexplained answers. "
                    "When an image is attached, inspect it carefully and say if any part is unclear. "
                    "Never pretend to read details that are not visible."
                ),
            },
            *conversation,
        ],
    }
    http_request = urllib.request.Request(
        f"{ollama_url}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(http_request, timeout=180) as response:
            response_data = json.loads(response.read(1024 * 1024 + 1).decode("utf-8"))
    except urllib.error.HTTPError as error:
        details = error.read(2048).decode("utf-8", errors="replace")
        if error.code == 404:
            return jsonify(
                error=f"Ollama could not find “{model}”. Run `ollama pull {model}` and try again."
            ), 503
        return jsonify(error=f"Ollama returned an error ({error.code}): {details[:500]}"), 502
    except urllib.error.URLError:
        return jsonify(
            error="Buddy cannot reach Ollama. Start Ollama locally, then try again."
        ), 503
    except TimeoutError:
        return jsonify(error="Buddy took too long to respond. Try again in a moment."), 504
    except (UnicodeDecodeError, json.JSONDecodeError):
        return jsonify(error="Ollama returned an unreadable response. Please try again."), 502

    if not isinstance(response_data, dict):
        return jsonify(error="Ollama returned an unreadable response. Please try again."), 502
    message_data = response_data.get("message")
    reply = message_data.get("content") if isinstance(message_data, dict) else None
    if not isinstance(reply, str) or not reply.strip():
        return jsonify(error="Ollama did not return an answer. Please try again."), 502
    return jsonify(reply=reply.strip())


initialize_db()


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "5000")),
        debug=os.environ.get("FLASK_DEBUG") == "1",
    )
