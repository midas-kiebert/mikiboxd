import { Link } from "@tanstack/react-router"
import { MovieSummaryLoggedIn } from "@/client";
import { useIsMobile } from "@/hooks/useIsMobile";

type MoviePosterProps = {
    movie: MovieSummaryLoggedIn;
    size?: string;
};

export default function MoviePoster({
    movie,
    size = "225px"
}: MoviePosterProps) {
    const isMobile = useIsMobile();
    const borderRadius = isMobile ? "6px" : "0px";
    return (
        <Link
            to={"/movie/$movieId"}
            params={{ movieId: `${movie.id}`}}
            style={{
                display: "inline-block",
                height: size,
                width: `calc(${size} * 2 / 3)px`,
            }}
        >
            <img
                src={movie.poster_link || "https://via.placeholder.com/150"}
                alt={movie.title}
                className="movie-poster"
                style={{
                    height: "100%",
                    width: "auto",
                    objectFit: "cover",
                    display: "block",
                    borderRadius: borderRadius,
                }}
            />
        </Link>
    );
}
