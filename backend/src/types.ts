export type MessageKind = "text" | "image" | "video" | "file";

export interface ChatMessageInput {
  sender: string;
  receiver: string;
  kind: MessageKind;
  text?: string;
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
}
