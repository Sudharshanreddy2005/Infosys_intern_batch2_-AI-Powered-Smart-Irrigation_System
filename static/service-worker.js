self.addEventListener("push", (event) => {
    let data = {
        title: "Smart Irrigation Alert",
        body: "You have a new irrigation alert."
    };

    if (event.data) {
        try {
            data = { ...data, ...event.data.json() };
        } catch (error) {
            data.body = event.data.text();
        }
    }

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: "/static/images/sidebar-leaves.svg",
            badge: "/static/images/sidebar-leaves.svg",
            data: {
                url: data.url || "/dashboard"
            }
        })
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();

    event.waitUntil(
        clients.openWindow(event.notification.data.url || "/dashboard")
    );
});