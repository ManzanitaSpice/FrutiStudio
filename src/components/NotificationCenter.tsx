import { useNotifications } from "../hooks/useNotifications";
import "./NotificationCenter.css";

export const NotificationCenter = () => {
  const { notifications, removeNotification } = useNotifications();

  return (
    <div className="notification-center" aria-live="polite">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`notification notification--${notification.type}`}
        >
          <span>{notification.message}</span>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => removeNotification(notification.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
};
