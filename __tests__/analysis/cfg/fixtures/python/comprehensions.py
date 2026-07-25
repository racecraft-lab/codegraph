def summarize_items(items, minimum):
    names = [item.name for item in items if item.active]
    kinds = {item.kind for item in items if item.kind}
    scores = {item.name: item.score for item in items if item.score >= minimum}
    first_score = next((item.score for item in items if item.score >= minimum), None)
    return names, kinds, scores, first_score
