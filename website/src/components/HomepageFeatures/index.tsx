import type { ReactNode } from "react";
import clsx from "clsx";
import Heading from "@theme/Heading";
import publishImage from "@site/static/img/publish.png";
import readImage from "@site/static/img/read.png";
import uploadImage from "@site/static/img/upload.png";
import styles from "./styles.module.css";

type FeatureItem = {
    title: string;
    Img: string;
    description: ReactNode;
};

const FeatureList: FeatureItem[] = [
    {
        title: "发布文章或回答",
        Img: publishImage,
        description: (
            <>
                支持一切知乎富文本编辑器功能，让您可以轻松地在 Obsidian
                内发布文章或回答。
            </>
        ),
    },
    {
        title: "浏览知乎",
        Img: readImage,
        description: (
            <>
                浏览个性化推荐、关注和热榜。点击后一键生成markdown，再也不用担心知识的荒原。
            </>
        ),
    },
    {
        title: "轻松上传图片",
        Img: uploadImage,
        description: (
            <>
                插件支持一键上传图片资源，只需要提供图片链接，插件就自动完成剩下的部分。
            </>
        ),
    },
];

function Feature({ title, description, Img }: FeatureItem) {
    return (
        <div className={clsx("col col--4")}>
            <div className="text--center">
                <img src={Img} className={styles.featureImg} alt={title} />
            </div>
            <div className="text--center padding-horiz--md">
                <Heading as="h3">{title}</Heading>
                <p>{description}</p>
            </div>
        </div>
    );
}

export default function HomepageFeatures(): ReactNode {
    return (
        <section className={styles.features}>
            <div className="container">
                <div className="row">
                    {FeatureList.map((props, idx) => (
                        <Feature key={idx} {...props} />
                    ))}
                </div>
            </div>
        </section>
    );
}
