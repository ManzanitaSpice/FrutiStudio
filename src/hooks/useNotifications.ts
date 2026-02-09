import { useContext } from "react";

import { NotificationContext } from "../context/NotificationContext";

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications debe usarse dentro de NotificationProvider");
  }
  return context;
};
