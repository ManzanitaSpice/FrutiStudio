import { createContext, useCallback, useMemo, useReducer } from "react";

export interface NotificationItem {
  id: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
}

type Action =
  | { type: "push"; payload: NotificationItem }
  | { type: "remove"; payload: string }
  | { type: "clear" };

const reducer = (state: NotificationItem[], action: Action): NotificationItem[] => {
  switch (action.type) {
    case "push":
      return [action.payload, ...state].slice(0, 5);
    case "remove":
      return state.filter((item) => item.id !== action.payload);
    case "clear":
      return [];
    default:
      return state;
  }
};

export interface NotificationContextValue {
  notifications: NotificationItem[];
  pushNotification: (item: Omit<NotificationItem, "id">) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
}

export const NotificationContext = createContext<
  NotificationContextValue | undefined
>(undefined);

export const NotificationProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [notifications, dispatch] = useReducer(reducer, []);

  const pushNotification = useCallback(
    (item: Omit<NotificationItem, "id">) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      dispatch({ type: "push", payload: { ...item, id } });
    },
    [],
  );

  const removeNotification = useCallback(
    (id: string) => dispatch({ type: "remove", payload: id }),
    [],
  );

  const clearNotifications = useCallback(
    () => dispatch({ type: "clear" }),
    [],
  );

  const value = useMemo(
    () => ({
      notifications,
      pushNotification,
      removeNotification,
      clearNotifications,
    }),
    [clearNotifications, notifications, pushNotification, removeNotification],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};
