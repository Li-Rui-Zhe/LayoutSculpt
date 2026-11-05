"""Revalidate the application entry without disabling model/asset caching."""

from fastapi.staticfiles import StaticFiles


class FrontendFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if path in {".", "", "index.html"} or response.headers.get(
            "content-type", ""
        ).startswith("text/html"):
            response.headers["Cache-Control"] = "no-store"
        return response
