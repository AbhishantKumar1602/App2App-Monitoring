import http.server
import socketserver
import webbrowser
import threading
import os
import subprocess
from flask import Flask, jsonify, request

PORT = 8000
FOLDER = os.path.dirname(os.path.abspath(__file__))

os.chdir(FOLDER)

# --- Flask API for update button ---
app = Flask(__name__)

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

@app.route('/run-dashboard-bat', methods=['POST'])
def run_dashboard_bat():
    def run_script():
        subprocess.run([
            'cmd.exe', '/c', os.path.join(FOLDER, 'run_dashboard.bat')], check=False)
    threading.Thread(target=run_script).start()
    return jsonify({'success': True})

def start_flask():
    app.run(port=5000, debug=False, use_reloader=False)

def start_server():
    handler = http.server.SimpleHTTPRequestHandler
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print(f"🚀 Server running at http://localhost:{PORT}")
        httpd.serve_forever()

# Start both servers in background
threading.Thread(target=start_server, daemon=True).start()
threading.Thread(target=start_flask, daemon=True).start()

# Open browser automatically
webbrowser.open(f"http://localhost:{PORT}/index.html")

input("Press ENTER to stop server...")
