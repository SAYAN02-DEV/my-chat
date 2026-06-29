import { Schema, model, Document } from "mongoose";
import { MessageKind } from "../types";

export interface MessageDoc extends Document {
  sender: string;
  receiver: string;
  kind: MessageKind;
  text?: string;
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
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
  createdAt: { type: Date, default: Date.now },
});

export const Message = model<MessageDoc>("Message", MessageSchema);
