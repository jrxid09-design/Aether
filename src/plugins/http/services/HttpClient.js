class HttpClient {

    static async request(url, options = {}) {

        const {
            timeout = 30000,
            ...fetchOptions
        } = options;

        const controller = new AbortController();

        const timer = setTimeout(() => {
            controller.abort();
        }, timeout);

        try {

            // Auto JSON body
            if (
                fetchOptions.body &&
                typeof fetchOptions.body === "object" &&
                !(fetchOptions.body instanceof FormData)
            ) {

                fetchOptions.headers = {
                    "Content-Type": "application/json",
                    ...(fetchOptions.headers || {})
                };

                fetchOptions.body = JSON.stringify(fetchOptions.body);

            }

            const response = await fetch(url, {
                ...fetchOptions,
                signal: controller.signal
            });

            clearTimeout(timer);

            const contentType = response.headers.get("content-type") || "";

            let data;

            if (contentType.includes("application/json")) {
                data = await response.json();
            } else {
                data = await response.text();
            }

            return {
                success: response.ok,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                data
            };

        } catch (error) {

            clearTimeout(timer);

            return {
                success: false,
                error: error.message
            };

        }

    }

    static get(url, options = {}) {

        return this.request(url, {
            method: "GET",
            ...options
        });

    }

    static post(url, options = {}) {

        return this.request(url, {
            method: "POST",
            ...options
        });

    }

    static put(url, options = {}) {

        return this.request(url, {
            method: "PUT",
            ...options
        });

    }

    static patch(url, options = {}) {

        return this.request(url, {
            method: "PATCH",
            ...options
        });

    }

    static delete(url, options = {}) {

        return this.request(url, {
            method: "DELETE",
            ...options
        });

    }

    static head(url, options = {}) {

        return this.request(url, {
            method: "HEAD",
            ...options
        });

    }

}

module.exports = HttpClient;