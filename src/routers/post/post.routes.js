const API_BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://backendkqxs.onrender.com";

export const getPosts = async (page = 1, limit = 10) => {
    const url = `${API_BASE_URL}/api/posts?page=${page}&limit=${limit}`;
    console.log("Fetching posts from:", url);
    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Cache-Control": "no-cache",
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.log("Error response from server:", errorText);
            throw new Error(`Có lỗi khi lấy danh sách bài viết: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log("Posts data:", result);
        return result;
    } catch (error) {
        console.error("Error in getPosts:", error);
        throw error;
    }
};

export const createPost = async (postData) => {
    const session = await getSession();
    const url = `${API_BASE_URL}/api/posts`;
    console.log("Creating post at:", url);
    try {
        const formData = new FormData();
        formData.append("title", postData.title);
        formData.append("description", postData.description);
        if (postData.img) {
            formData.append("img", postData.img);
        }

        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${session?.accessToken}`,
                "Cache-Control": "no-cache",
            },
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.log("Error response from server:", errorText);
            throw new Error(`Có lỗi khi đăng bài: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log("Post created:", result);
        return result;
    } catch (error) {
        console.error("Error in createPost:", error);
        throw error;
    }
};

export const getPostById = async (id) => {
    const url = `${API_BASE_URL}/api/posts/${id}`;
    console.log("Fetching post with ID:", id);
    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Cache-Control": "no-cache",
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.log("Error response from server:", errorText);
            throw new Error(`Có lỗi khi lấy bài viết: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log("Post data:", result);
        return result;
    } catch (error) {
        console.error("Error in getPostById:", error);
        throw error;
    }
};