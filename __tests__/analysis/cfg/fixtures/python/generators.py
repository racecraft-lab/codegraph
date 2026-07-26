def stream_chunks(chunks, fallback):
    for chunk in chunks:
        if chunk:
            yield chunk
    yield from fallback
