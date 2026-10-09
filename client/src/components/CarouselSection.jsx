import Carousel from "./Carousel";

export default function CarouselSection({
  sectionClass = "",
  title = "",
  dataSource,
  actionButton = null,
  authenticated = false,
}) {
  return (
    <section className={`carousel-section ${sectionClass}`}>
      <div className="layout-wrapper">
        <div className="section-header">
          {title && <h2 className="section-title">{title}</h2>}
          {actionButton && <div className="section-button">{actionButton}</div>}
        </div>
        <Carousel dataSource={dataSource} authenticated={authenticated} label={title || "Recipe collection"} />
      </div>
    </section>
  );
}
