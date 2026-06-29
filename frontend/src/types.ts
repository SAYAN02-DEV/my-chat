export type MessageKind = "text" | "image" | "video" | "file";

export interface ChatMessage {
  _id?: string;
  sender: string;
  receiver: string;
  kind: MessageKind;
  text?: string;
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
  createdAt?: string;
}
