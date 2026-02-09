import { useCallback } from "react";

import { esMessages, type Messages } from "./es";

type MessageKey = keyof Messages;

const messages: Messages = esMessages;

export const useI18n = () => {
  const t = useCallback(<T extends MessageKey>(key: T): Messages[T] => {
    return messages[key];
  }, []);

  return { t };
};
