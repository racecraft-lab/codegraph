export type AnnouncementTone = "polite" | "assertive"

export interface StatusAnnouncement {
  id: number
  message: string
  tone: AnnouncementTone
}

let nextId = 1

export function createAnnouncement(message: string, tone: AnnouncementTone = "polite"): StatusAnnouncement {
  return { id: nextId++, message, tone }
}
