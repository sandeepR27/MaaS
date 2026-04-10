# Routes package - ensure parent directory is on sys.path
import sys
import os

# Add the python/ directory to the path so routes can import top-level modules
_parent = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _parent not in sys.path:
    sys.path.insert(0, _parent)