"""Launch VARELQ with a key entered into a hidden terminal prompt."""
import getpass
import os
import runpy

if not os.getenv("NVIDIA_API_KEY"):
    key = getpass.getpass("NVIDIA Build API key (hidden; kept only in this process): ").strip()
    if not key:
        raise SystemExit("An NVIDIA API key is required for live analysis.")
    os.environ["NVIDIA_API_KEY"] = key

runpy.run_path(os.path.join(os.path.dirname(__file__), "server.py"), run_name="__main__")
