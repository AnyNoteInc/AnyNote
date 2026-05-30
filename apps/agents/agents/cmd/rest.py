from agents.bootstrap import create_app
from agents.router import apply_routes

app = create_app([apply_routes])
