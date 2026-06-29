import { Schema, model, Document } from "mongoose";
import { MessageKind, MessageStatus } from "../types";

export interface MessageDoc extends Document {
  sender: string;
  receiver: string;
  kind: MessageKind;
  text?: string;
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
  status: MessageStatus;
  createdAt: Date;
}

const MessageSchema = new Schema<MessageDoc>({
  sender: { type: String, required: true },
  receiver: { type: String, required: true },
  kind: {
    type: String,
    enum: ["text", "image", "video", "file"],
    required: true,
  },
  text: { type: String },
  fileUrl: { type: String },
  fileName: { type: String },
  mimeType: { type: String },
  status: {
    type: String,
    enum: ["sent", "delivered", "seen"],
    default: "sent",
  },
  createdAt: { type: Date, default: Date.now },
});

export const Message = model<MessageDoc>("Message", MessageSchema);