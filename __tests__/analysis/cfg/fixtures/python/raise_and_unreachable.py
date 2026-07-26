def require_name(record):
    if "name" not in record:
        raise ValueError("missing name")
    if record["name"]:
        return "accepted"
        unreachable_after_return = "never reached"
    raise RuntimeError("empty name")
