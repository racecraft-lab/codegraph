def route_event(event):
    match event:
        case {"type": "click", "target": target} if target:
            return ("click", target)
        case {"type": "submit"}:
            return ("submit", None)
        case {"type": other}:
            return ("known", other)
        case _:
            return ("unknown", None)
