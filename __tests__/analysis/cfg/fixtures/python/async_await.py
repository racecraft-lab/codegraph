async def fetch_profile(client, user_id):
    response = await client.fetch_profile(user_id)
    if response.status == 404:
        return await client.refresh_profile(user_id)
    if response.ok:
        return response.payload
    return None
