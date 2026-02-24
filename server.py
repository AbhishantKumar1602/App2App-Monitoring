import http.server
import socketserver
import webbrowser
import threading
import os

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        pass  # Suppress all logging

def open_browser():
    import time
    time.sleep(1.5)
    webbrowser.open(f"http://localhost:{PORT}/index.html")

# Open browser in background
threading.Thread(target=open_browser, daemon=True).start()

# Start server — blocks forever, keeps process alive
with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    httpd.allow_reuse_address = True
    httpd.serve_forever()
