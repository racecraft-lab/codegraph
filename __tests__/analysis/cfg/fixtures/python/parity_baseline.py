def branch_loop_parity(items):
    total = 0
    attempts = 0
    for item in items:
        if item is None:
            continue
        if item < 0:
            break
        total += item
    while attempts < 3:
        if total > 10:
            return total
        attempts += 1
        total += attempts
    return total
