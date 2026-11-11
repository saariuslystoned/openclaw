/** An authorized conversational observation, never task or execution approval. */
export type ChannelReactionContext = {
  channel: string;
  accountId: string;
  conversationId: string;
  actorId: string;
  occurrenceId: string;
  action: "added" | "removed";
  emoji: string;
  target: {
    messageId: string;
    authorId?: string;
    body?: string;
  };
};
